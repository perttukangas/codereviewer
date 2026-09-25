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
import { PerformanceAgent } from "./agents/performance.js";
import { VerifierAgent } from "./agents/verifier.js";
import { getReviewEnv } from "./env.js";
import { formatReviewPrompt, formatVerificationPrompt } from "./prompt.js";
import { createEditReviewFindingTool } from "./tools/edit-review-finding.js";
import { nextFindingId } from "./tools/review-finding.js";
import { createReviewFindingTool } from "./tools/submit-review-finding.js";
import type { AgentReview, ReviewFinding, ReviewReport } from "./types.js";

const agents: Agent[] = [CodeQualityAgent, PerformanceAgent];

const toGuardrailFinding = (
	id: number,
	outcome: GuardrailOutcome,
): ReviewFinding => {
	const dimension = describeDimension(outcome.dimension);
	const unit = outcome.dimension === "timeout" ? "ms" : "tokens";

	return {
		id,
		title: `Review truncated by guardrail (${outcome.dimension})`,
		severity: "info",
		confidence: 1,
		problem: `The agent reached the ${dimension} of ${outcome.limit} ${unit} (observed ${outcome.observed} ${unit}) and was terminated before completing the review. Findings reported here may be incomplete.`,
		rationale:
			"Increase the corresponding per agent guardrail budget or timeout if the review requires more time or tokens.",
	};
};

const toErrorFinding = (
	id: number,
	agent: Agent,
	cause: unknown,
): ReviewFinding => {
	const message = cause instanceof Error ? cause.message : String(cause);

	return {
		id,
		title: `Review agent failed (${agent.id})`,
		severity: "info",
		confidence: 1,
		problem: `The ${agent.id} review agent failed before completing its review. Any findings reported here may be incomplete. Error: ${message}`,
		rationale:
			"Investigate the reported error and re-run the review. Other review agents completed independently and their findings are unaffected.",
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

	return Object.fromEntries(results);
};

const runAgentPipeline = async (
	context: WorkflowContext,
	agent: Agent,
	repositoryDir: string,
	diff: string,
): Promise<[string, AgentReview]> => {
	const findings: AgentReview = [];

	try {
		await reviewAgent(context, agent, repositoryDir, diff, findings);
		if (getAgentConfig(VerifierAgent).enabled) {
			await verifyReview(context, agent, findings, repositoryDir, diff);
		} else {
			debug("Skipping disabled verifier agent", VerifierAgent.id);
		}
	} catch (cause) {
		error("Review agent failed", agent.id, cause);
		findings.push(toErrorFinding(nextFindingId(findings), agent, cause));
	}

	return [agent.id, findings];
};

const reviewAgent = async (
	context: WorkflowContext,
	agent: Agent,
	repositoryDir: string,
	diff: string,
	findings: AgentReview,
): Promise<void> => {
	const reviewFindingTool = createReviewFindingTool(repositoryDir, findings);
	let session: GuardedAgentSession<AgentReview> | undefined;
	try {
		info("Creating agent session", agent.id);
		session = await createAgent<AgentReview>(agent, context.runtime, {
			config: getAgentConfig(agent),
			customTools: [reviewFindingTool],
			output: findings,
		});
		startTimer(agent.id, "Starting agent review");
		const response = await session.prompt(formatReviewPrompt(agent, diff));
		for (const outcome of response.guardrails) {
			if (outcome.terminated) {
				findings.push(toGuardrailFinding(nextFindingId(findings), outcome));
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
	findings: AgentReview,
	repositoryDir: string,
	diff: string,
): Promise<void> => {
	if (findings.length === 0) {
		info("Skipping verification, no findings to verify", reviewer.id);
		return;
	}

	const timerId = `${reviewer.id}:${VerifierAgent.id}`;
	const editFindingTool = createEditReviewFindingTool(repositoryDir, findings);
	let session: GuardedAgentSession<AgentReview> | undefined;
	try {
		info("Creating agent session", timerId);
		session = await createAgent<AgentReview>(VerifierAgent, context.runtime, {
			config: getAgentConfig(VerifierAgent),
			customTools: [editFindingTool],
			output: findings,
		});
		startTimer(timerId, "Starting agent verification");
		const response = await session.prompt(
			formatVerificationPrompt(VerifierAgent, reviewer, findings, diff),
		);
		for (const outcome of response.guardrails) {
			if (outcome.terminated) {
				error(
					"Verification truncated by guardrail",
					VerifierAgent.id,
					outcome.dimension,
					`${outcome.observed}/${outcome.limit}`,
				);
			}
		}
	} finally {
		session?.dispose();
		stopTimer(timerId, "Completed agent verification");
	}
};

export const reviewWorkflow: Workflow<ReviewReport> = {
	id: "review",
	run,
};
