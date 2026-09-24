import { access, constants, stat } from "node:fs/promises";

import { cleanEnv, json, num, str } from "envalid";

import type {
	Agent,
	AgentGuardrails,
	AgentLimits,
	AgentModel,
} from "../agent-runtime/types.js";

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

	MODEL_API_KEY: str({
		desc: "The API key for the model API.",
	}),

	REPO_DIR: str({
		desc: "The path to the repository directory.",
	}),

	GIT_DIFF_PATH: str({
		desc: "The path to the git diff file.",
	}),

	DEFAULT_MODEL_NAME: str({
		desc: "The default model name for agents.",
	}),

	DEFAULT_MODEL_SAMPLING_PARAMS: json<Record<string, unknown>>({
		desc: "The default model sampling parameters for agents.",
		default: {},
	}),

	DEFAULT_CONTEXT_WINDOW: num({
		desc: "The default model context window for agents.",
		default: 131072,
	}),

	DEFAULT_MAX_OUTPUT_TOKENS: num({
		desc: "The default maximum model output tokens for agents.",
		default: 16384,
	}),

	DEFAULT_TIMEOUT_MS: num({
		desc: "The default wall clock timeout in milliseconds for an agent prompt. Zero disables the timeout.",
		default: 300000,
	}),

	DEFAULT_INPUT_TOKEN_BUDGET: num({
		desc: "The default input token budget for an agent prompt. Zero disables the budget.",
		default: 100000,
	}),

	DEFAULT_OUTPUT_TOKEN_BUDGET: num({
		desc: "The default output token budget for an agent prompt. Zero disables the budget.",
		default: 20000,
	}),

	DEFAULT_SOFT_LIMIT_RATIO: num({
		desc: "The default ratio of a hard guardrail limit at which a soft warning is issued.",
		default: 0.8,
	}),
});

const toEnvPrefix = (agentId: string): string =>
	agentId.replace(/[^a-zA-Z0-9]/g, "_").toUpperCase();

export const getAgentConfig = (
	agent: Agent,
): {
	model: AgentModel;
	limits: AgentLimits;
	guardrails: AgentGuardrails;
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
		[`${prefix}_TIMEOUT_MS`]: num({
			default: env.DEFAULT_TIMEOUT_MS,
		}),
		[`${prefix}_INPUT_TOKEN_BUDGET`]: num({
			default: env.DEFAULT_INPUT_TOKEN_BUDGET,
		}),
		[`${prefix}_OUTPUT_TOKEN_BUDGET`]: num({
			default: env.DEFAULT_OUTPUT_TOKEN_BUDGET,
		}),
		[`${prefix}_SOFT_LIMIT_RATIO`]: num({
			default: env.DEFAULT_SOFT_LIMIT_RATIO,
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
		guardrails: {
			timeoutMs: config[`${prefix}_TIMEOUT_MS`] as number,
			inputTokenBudget: config[`${prefix}_INPUT_TOKEN_BUDGET`] as number,
			outputTokenBudget: config[`${prefix}_OUTPUT_TOKEN_BUDGET`] as number,
			softLimitRatio: config[`${prefix}_SOFT_LIMIT_RATIO`] as number,
		},
	};
};

export const validateInputs = async (): Promise<void> => {
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

	await access(env.REPO_DIR, constants.R_OK | constants.X_OK);
	await access(env.GIT_DIFF_PATH, constants.R_OK);
};
