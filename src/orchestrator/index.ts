import { readFile } from "node:fs/promises";

import { createAgent } from "../agent-runtime/index.js";
import type { Agent, AgentReview } from "../agent-runtime/types.js";
import { CodeQualityAgent } from "../agents/code-quality.js";
import { PerformanceAgent } from "../agents/performance.js";
import { env } from "../utils/env.js";
import { info } from "../utils/logger.js";

const agents: Agent[] = [CodeQualityAgent, PerformanceAgent];

export const orchestrate = async () => {
	info("Reading Git diff", env.GIT_DIFF_PATH);
	const diff = await readFile(env.GIT_DIFF_PATH, "utf8");
	const responses: Record<string, AgentReview> = {};

	for (const agent of agents) {
		info("Starting agent review", agent.id);
		const session = await createAgent(agent);
		try {
			responses[agent.id] = await session.prompt(
				`${agent.prompt}\n\nReview the following Git diff.\n\n${diff}`,
			);
			info("Completed agent review", agent.id);
		} finally {
			session.dispose();
		}
	}

	return responses;
};
