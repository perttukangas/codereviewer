import { access, constants, stat } from "node:fs/promises";

import { createAgent } from "../../engine/agent.js";
import { getAgentConfig } from "../../engine/agent-config.js";
import { describeDimension } from "../../engine/guardrails.js";
import type {
	Agent,
	GuardedAgentSession,
	GuardrailOutcome,
} from "../../engine/types.js";
import { createLocalGitChangeSource } from "../../integrations/local-git.js";
import type { ChangeSource } from "../../integrations/types.js";
import { env } from "../../platform/env.js";
import {
	debug,
	error,
	info,
	startTimer,
	stopTimer,
} from "../../platform/logger.js";
import type { Workflow, WorkflowContext } from "../types.js";
import { CodeQualityAgent } from "./agents/code-quality.js";
import { DeduplicatorAgent } from "./agents/deduplicator.js";
import { PerformanceAgent } from "./agents/performance.js";
import { VerifierAgent } from "./agents/verifier.js";
import { getReviewEnv } from "./env.js";
import {
	formatDeduplicationPrompt,
	formatReviewPrompt,
	formatVerificationPrompt,
} from "./prompt.js";
import { createEditReviewFindingTool } from "./tools/edit-review-finding.js";
import { createMergeReviewFindingsTool } from "./tools/merge-review-findings.js";
import { nextId, severityValues } from "./tools/review-finding.js";
import { createReviewFindingTool } from "./tools/submit-review-finding.js";
import type { AgentReview, ReviewError, ReviewReport } from "./types.js";

const agents: Agent[] = [CodeQualityAgent, PerformanceAgent];

const toGuardrailError = (
	id: string,
	agentId: string,
	outcome: GuardrailOutcome,
): ReviewError => {
	const dimension = describeDimension(outcome.dimension);
	const unit = outcome.dimension === "timeout" ? "ms" : "tokens";

	return {
		id,
		agentId,
		kind: "guardrail",
		dimension: outcome.dimension,
		limit: outcome.limit,
		observed: outcome.observed,
		message: `The agent reached the ${dimension} of ${outcome.limit} ${unit} (observed ${outcome.observed} ${unit}) and was terminated before completing the review. Findings reported here may be incomplete.`,
	};
};

const toErrorError = (
	id: string,
	agent: Agent,
	cause: unknown,
): ReviewError => {
	const message = cause instanceof Error ? cause.message : String(cause);

	return {
		id,
		agentId: agent.id,
		kind: "error",
		message: `The ${agent.id} review agent failed before completing its review. Any findings reported here may be incomplete. Error: ${message}`,
	};
};

export const validateReviewInputs = async (): Promise<void> => {
	const { GIT_DIFF_PATH } = getReviewEnv();

	const repository = await stat(env.REPO_DIR).catch(() => undefined);
	if (!repository?.isDirectory()) {
		throw new Error(`REPO_DIR is not a readable directory: ${env.REPO_DIR}`);
	}

	const diff = await stat(GIT_DIFF_PATH).catch(() => undefined);
	if (!diff?.isFile()) {
		throw new Error(`GIT_DIFF_PATH is not a readable file: ${GIT_DIFF_PATH}`);
	}

	await access(env.REPO_DIR, constants.R_OK);
	await access(GIT_DIFF_PATH, constants.R_OK);
};

export const run = async (context: WorkflowContext): Promise<ReviewReport> => {
	await validateReviewInputs();

	const { GIT_DIFF_PATH } = getReviewEnv();
	const changeSource: ChangeSource = createLocalGitChangeSource(GIT_DIFF_PATH);

	info("Reading Git diff", GIT_DIFF_PATH);
	const changeSet = await changeSource.load();

	const enabledAgents = agents.filter((agent) => {
		if (getAgentConfig(agent).enabled) {
			return true;
		}
		debug("Skipping disabled review agent", agent.id);
		return false;
	});

	const results = await Promise.all(
		enabledAgents.map((agent) =>
			runAgentPipeline(context, agent, changeSet.repositoryDir, changeSet.diff),
		),
	);

	const report: ReviewReport = Object.fromEntries(results);
	await deduplicate(context, report);

	return report;
};

const runAgentPipeline = async (
	context: WorkflowContext,
	agent: Agent,
	repositoryDir: string,
	diff: string,
): Promise<[string, AgentReview]> => {
	const review: AgentReview = { findings: [], errors: [] };

	try {
		await reviewAgent(context, agent, repositoryDir, diff, review);
		if (getAgentConfig(VerifierAgent).enabled) {
			await verifyReview(context, agent, review, repositoryDir, diff);
		} else {
			debug("Skipping disabled verifier agent", VerifierAgent.id);
		}
	} catch (cause) {
		error("Review agent failed", agent.id, cause);
		review.errors.push(
			toErrorError(nextId(review.errors, `${agent.id}:error`), agent, cause),
		);
	}

	info(
		`Agent reported ${review.findings.length} findings`,
		agent.id,
		severityValues
			.map(
				(severity) =>
					`${severity}=${review.findings.filter((finding) => finding.severity === severity).length}`,
			)
			.join(", "),
	);

	return [agent.id, review];
};

const reviewAgent = async (
	context: WorkflowContext,
	agent: Agent,
	repositoryDir: string,
	diff: string,
	review: AgentReview,
): Promise<void> => {
	const reviewFindingTool = createReviewFindingTool(
		agent,
		repositoryDir,
		review.findings,
	);
	let session: GuardedAgentSession<AgentReview> | undefined;
	try {
		info("Creating agent session", agent.id);
		session = await createAgent<AgentReview>(agent, context.runtime, {
			config: getAgentConfig(agent),
			customTools: [reviewFindingTool],
			output: review,
		});
		startTimer(agent.id, "Starting agent review");
		const response = await session.prompt(formatReviewPrompt(agent, diff));
		for (const outcome of response.guardrails) {
			if (outcome.terminated) {
				review.errors.push(
					toGuardrailError(
						nextId(review.errors, `${agent.id}:error`),
						agent.id,
						outcome,
					),
				);
			}
		}
	} finally {
		session?.dispose();
		stopTimer(agent.id, "Completed agent review");
	}
};

const verifyReview = async (
	context: WorkflowContext,
	reviewer: Agent,
	review: AgentReview,
	repositoryDir: string,
	diff: string,
): Promise<void> => {
	const eligible = review.findings;
	if (eligible.length === 0) {
		info("Skipping verification, no eligible findings to verify", reviewer.id);
		return;
	}

	const timerId = `${reviewer.id}:${VerifierAgent.id}`;
	const editFindingTool = createEditReviewFindingTool(
		repositoryDir,
		review.findings,
	);
	let session: GuardedAgentSession<AgentReview> | undefined;
	try {
		info("Creating agent session", timerId);
		session = await createAgent<AgentReview>(VerifierAgent, context.runtime, {
			config: getAgentConfig(VerifierAgent),
			customTools: [editFindingTool],
			output: review,
		});
		startTimer(timerId, "Starting agent verification");
		const response = await session.prompt(
			formatVerificationPrompt(VerifierAgent, reviewer, eligible, diff),
		);
		for (const outcome of response.guardrails) {
			if (outcome.terminated) {
				review.errors.push(
					toGuardrailError(
						nextId(review.errors, `${timerId}:error`),
						VerifierAgent.id,
						outcome,
					),
				);
			}
		}
	} finally {
		session?.dispose();
		stopTimer(timerId, "Completed agent verification");
	}
};

const deduplicate = async (
	context: WorkflowContext,
	report: ReviewReport,
): Promise<void> => {
	if (!getAgentConfig(DeduplicatorAgent).enabled) {
		debug("Skipping disabled deduplicator agent", DeduplicatorAgent.id);
		return;
	}

	const eligible = Object.values(report)
		.flatMap((review) => review.findings)
		.filter((finding) => finding.invalidReason === undefined);
	if (eligible.length < 2) {
		info(
			"Skipping deduplication, fewer than two eligible findings",
			DeduplicatorAgent.id,
		);
		return;
	}

	const dedupReview: AgentReview = { findings: [], errors: [] };
	const mergeTool = createMergeReviewFindingsTool(
		env.REPO_DIR,
		report,
		dedupReview,
	);
	let session: GuardedAgentSession<AgentReview> | undefined;
	try {
		info("Creating agent session", DeduplicatorAgent.id);
		session = await createAgent<AgentReview>(
			DeduplicatorAgent,
			context.runtime,
			{
				config: getAgentConfig(DeduplicatorAgent),
				customTools: [mergeTool],
				output: dedupReview,
			},
		);
		startTimer(DeduplicatorAgent.id, "Starting agent deduplication");
		const response = await session.prompt(
			formatDeduplicationPrompt(DeduplicatorAgent, eligible),
		);
		for (const outcome of response.guardrails) {
			if (outcome.terminated) {
				dedupReview.errors.push(
					toGuardrailError(
						nextId(dedupReview.errors, `${DeduplicatorAgent.id}:error`),
						DeduplicatorAgent.id,
						outcome,
					),
				);
			}
		}
	} finally {
		session?.dispose();
		stopTimer(DeduplicatorAgent.id, "Completed agent deduplication");
	}

	if (dedupReview.findings.length > 0 || dedupReview.errors.length > 0) {
		report[DeduplicatorAgent.id] = dedupReview;
	}
};

export const reviewWorkflow: Workflow<ReviewReport> = {
	id: "review",
	run,
};
