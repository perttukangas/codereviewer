import { access, constants, stat } from "node:fs/promises";

import { createAgent } from "../../engine/agent.js";
import { getAgentConfig } from "../../engine/agent-config.js";
import { describeDimension } from "../../engine/guardrails.js";
import type { Agent, GuardrailOutcome } from "../../engine/types.js";
import { createLocalGitChangeSource } from "../../integrations/local-git.js";
import type { ChangeSource } from "../../integrations/types.js";
import { env } from "../../platform/env.js";
import { info, startTimer, stopTimer } from "../../platform/logger.js";
import type { Workflow, WorkflowContext } from "../types.js";
import { CodeQualityAgent } from "./agents/code-quality.js";
import { formatReviewPrompt } from "./prompt.js";
import { createReviewFindingTool } from "./tools/submit-review-finding.js";
import type { AgentReview, ReviewFinding, ReviewReport } from "./types.js";

const agents: Agent[] = [CodeQualityAgent];

const toGuardrailFinding = (outcome: GuardrailOutcome): ReviewFinding => {
	const dimension = describeDimension(outcome.dimension);
	const unit = outcome.dimension === "timeout" ? "ms" : "tokens";

	return {
		title: `Review truncated by guardrail (${outcome.dimension})`,
		severity: "info",
		confidence: 1,
		problem: `The agent reached the ${dimension} of ${outcome.limit} ${unit} (observed ${outcome.observed} ${unit}) and was terminated before completing the review. Findings reported here may be incomplete.`,
		rationale:
			"Increase the corresponding per agent guardrail budget or timeout if the review requires more time or tokens.",
	};
};

export const validateReviewInputs = async (): Promise<void> => {
	const repository = await stat(env.REPO_DIR).catch(() => undefined);
	if (!repository?.isDirectory()) {
		throw new Error(`REPO_DIR is not a readable directory: ${env.REPO_DIR}`);
	}

	const diff = await stat(env.GIT_DIFF_PATH).catch(() => undefined);
	if (!diff?.isFile()) {
		throw new Error(
			`GIT_DIFF_PATH is not a readable file: ${env.GIT_DIFF_PATH}`,
		);
	}

	await access(env.REPO_DIR, constants.R_OK);
	await access(env.GIT_DIFF_PATH, constants.R_OK);
};

export const run = async (context: WorkflowContext): Promise<ReviewReport> => {
	await validateReviewInputs();

	const changeSource: ChangeSource = createLocalGitChangeSource();

	info("Reading Git diff", env.GIT_DIFF_PATH);
	const changeSet = await changeSource.load();
	const responses: ReviewReport = {};

	for (const agent of agents) {
		responses[agent.id] = await reviewAgent(
			context,
			agent,
			changeSet.repositoryDir,
			changeSet.diff,
		);
	}

	return responses;
};

const reviewAgent = async (
	context: WorkflowContext,
	agent: Agent,
	repositoryDir: string,
	diff: string,
): Promise<AgentReview> => {
	startTimer(agent.id, "Starting agent review");
	const findings: AgentReview = [];
	const reviewFindingTool = createReviewFindingTool(
		repositoryDir,
		(finding) => {
			findings.push(finding);
		},
	);
	const session = await createAgent<AgentReview>(agent, context.runtime, {
		config: getAgentConfig(agent),
		customTools: [reviewFindingTool],
		output: findings,
	});
	try {
		const response = await session.prompt(formatReviewPrompt(agent, diff));
		for (const outcome of response.guardrails) {
			if (outcome.terminated) {
				findings.push(toGuardrailFinding(outcome));
			}
		}
		return response.output;
	} finally {
		session.dispose();
		stopTimer(agent.id, "Completed agent review");
	}
};

export const reviewWorkflow: Workflow<ReviewReport> = {
	id: "review",
	run,
};
