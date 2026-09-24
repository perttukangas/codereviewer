import { cleanEnv, json, num, str } from "envalid";

import { env } from "../platform/env.js";
import type { Agent, AgentConfig } from "./types.js";

const toEnvPrefix = (agentId: string): string =>
	agentId.replace(/[^a-zA-Z0-9]/g, "_").toUpperCase();

export const getAgentConfig = (agent: Agent): AgentConfig => {
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
