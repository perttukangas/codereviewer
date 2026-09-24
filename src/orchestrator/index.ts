import { readFile } from "node:fs/promises";

import { createAgent } from "../core/agent.js";
import { formatAgentPrompt } from "../core/agents/agent-utils.js";
import { CodeQualityAgent } from "../core/agents/code-quality.js";
import type { Agent, AgentReview } from "../core/types.js";
import { createAgentRuntime } from "../runtime/index.js";
import { createReviewFindingTool } from "../tools/submit_review_finding.js";
import { env, getAgentConfig } from "../utils/env.js";
import { info, startTimer, stopTimer } from "../utils/logger.js";

const agents: Agent[] = [CodeQualityAgent];

export const orchestrate = async () => {
	info("Reading Git diff", env.GIT_DIFF_PATH);
	const diff = await readFile(env.GIT_DIFF_PATH, "utf8");
	const runtime = createAgentRuntime();
	const responses: Record<string, AgentReview> = {};

	for (const agent of agents) {
		responses[agent.id] = await reviewAgent(runtime, agent, diff);
	}

	return responses;
};

const reviewAgent = async (
	runtime: ReturnType<typeof createAgentRuntime>,
	agent: Agent,
	diff: string,
): Promise<AgentReview> => {
	startTimer(agent.id, "Starting agent review");
	const findings: AgentReview = [];
	const reviewFindingTool = createReviewFindingTool(env.REPO_DIR, (finding) => {
		findings.push(finding);
	});
	const session = await createAgent<AgentReview>(agent, runtime, {
		config: getAgentConfig(agent),
		customTools: [reviewFindingTool],
		output: findings,
		onGuardrailFinding: (finding) => findings.push(finding),
	});
	try {
		const response = await session.prompt(formatAgentPrompt(agent, diff));
		return response.output;
	} finally {
		session.dispose();
		stopTimer(agent.id, "Completed agent review");
	}
};
