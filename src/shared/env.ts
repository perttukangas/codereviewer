import { cleanEnv, json, num, str } from "envalid";

export const env = cleanEnv(process.env, {
	LOG_LEVEL: str({
		choices: ["DEBUG", "INFO", "ERROR"],
		default: "INFO",
		desc: "The log level for the application.",
	}),

	LOG_DIR: str({
		default: "/tmp/codereviewer",
		desc: "The directory for log files. Holds combined.log and one file per agent. An empty value disables file logging.",
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

	AGENT_MAX_CONCURRENCY: num({
		desc: "The maximum number of agent sessions that may run concurrently. Zero disables the limit.",
		default: 4,
	}),
});
