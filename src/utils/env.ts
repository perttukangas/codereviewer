import { cleanEnv, json, num, str } from "envalid";

import type { Agent, AgentLimits, AgentModel } from "../agent-runtime/types.js";

export const env = cleanEnv(process.env, {
	LOG_LEVEL: str({
		choices: ["DEBUG", "INFO", "ERROR"],
		default: "INFO",
		desc: "The log level for the application.",
	}),

	MODEL_API: str({
		choices: ["openai-completions"],
		default: "openai-completions",
		desc: "The model API to use for the agent.",
	}),

	MODEL_PROVIDER: str({
		choices: ["custom"],
		default: "custom",
		desc: "The model provider to use for the agent.",
	}),

	MODEL_BASE_URL: str({
		desc: "The base URL for the model API.",
	}),

	REPO_DIR: str({
		desc: "The path to the repository directory.",
	}),

	DEFAULT_MODEL_NAME: str({
		desc: "The default model name for agents.",
	}),

	DEFAULT_MODEL_SAMPLING_PARAMS: json<Record<string, unknown>>({
		desc: "The default model sampling parameters for agents.",
	}),

	DEFAULT_CONTEXT_WINDOW: num({
		desc: "The default model context window for agents.",
	}),

	DEFAULT_MAX_OUTPUT_TOKENS: num({
		desc: "The default maximum model output tokens for agents.",
	}),
});

const toEnvPrefix = (agentId: string): string =>
	agentId.replace(/[^a-zA-Z0-9]/g, "_").toUpperCase();

export const getAgentConfig = (
	agent: Agent,
): {
	model: AgentModel;
	limits: AgentLimits;
} => {
	const prefix = toEnvPrefix(agent.id);
	const config = cleanEnv(process.env, {
		[`${prefix}_MODEL_NAME`]: str({
			default: env.DEFAULT_MODEL_NAME,
		}),
		[`${prefix}_MODEL_SAMPLING_PARAMS`]: json<Record<string, unknown>>({
			default: env.DEFAULT_MODEL_SAMPLING_PARAMS,
		}),
		[`${prefix}_CONTEXT_WINDOW`]: num({
			default: env.DEFAULT_CONTEXT_WINDOW,
		}),
		[`${prefix}_MAX_OUTPUT_TOKENS`]: num({
			default: env.DEFAULT_MAX_OUTPUT_TOKENS,
		}),
	});

	return {
		model: {
			name: config[`${prefix}_MODEL_NAME`] as string,
			samplingParams: config[`${prefix}_MODEL_SAMPLING_PARAMS`] as Record<
				string,
				unknown
			>,
		},
		limits: {
			contextWindow: config[`${prefix}_CONTEXT_WINDOW`] as number,
			maxOutputTokens: config[`${prefix}_MAX_OUTPUT_TOKENS`] as number,
		},
	};
};
