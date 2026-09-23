import { readFile } from "node:fs/promises";

import { createAgent } from "../agent-runtime/index.js";
import type { Agent, AgentReview } from "../agent-runtime/types.js";
import { formatAgentPrompt } from "../agents/agent-utils.js";
import { CodeQualityAgent } from "../agents/code-quality.js";
import { createReviewFindingTool } from "../tools/submit_review_finding.js";
import { env } from "../utils/env.js";
import { info, startTimer, stopTimer } from "../utils/logger.js";

const agents: Agent[] = [CodeQualityAgent];

export const orchestrate = async () => {
	info("Reading Git diff", env.GIT_DIFF_PATH);
	const diff = await readFile(env.GIT_DIFF_PATH, "utf8");
	const responses: Record<string, AgentReview> = {};

	for (const agent of agents) {
		responses[agent.id] = await reviewAgent(agent, diff);
	}

	return responses;
};

const reviewAgent = async (
	agent: Agent,
	diff: string,
): Promise<AgentReview> => {
	startTimer(agent.id, "Starting agent review");
	const findings: AgentReview = [];
	const reviewFindingTool = createReviewFindingTool(env.REPO_DIR, (finding) => {
		findings.push(finding);
	});
	const session = await createAgent(agent, [reviewFindingTool], findings);
	try {
		const response = await session.prompt(formatAgentPrompt(agent, diff));
		return response;
	} finally {
		session.dispose();
		stopTimer(agent.id, "Completed agent review");
	}
};
