import {
	createAgentSession,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { env, getAgentConfig } from "../utils/env.js";
import type { Agent, AgentSession } from "./types.js";

export const createAgent = async (agent: Agent): Promise<AgentSession> => {
	const config = getAgentConfig(agent);
	const { session } = await createAgentSession({
		cwd: env.REPO_DIR,
		model: {
			id: config.model.name,
			name: config.model.name,
			samplingParams: config.model.samplingParams,
			contextWindow: config.limits.contextWindow,
			maxTokens: config.limits.maxOutputTokens,
			api: env.MODEL_API,
			provider: env.MODEL_PROVIDER,
			baseUrl: env.MODEL_BASE_URL,
			reasoning: false, // Use sampling params
			input: ["text"],
			cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
		},
		tools: agent.tools,
		sessionManager: SessionManager.inMemory(env.REPO_DIR),
		settingsManager: SettingsManager.inMemory({
			compaction: { enabled: false },
		}),
	});

	return {
		prompt: session.prompt,
		dispose: session.dispose,
	};
};
