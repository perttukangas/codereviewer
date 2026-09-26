import type { AgentRuntimeEvent, RuntimeSession } from "../runtime/types.js";
import { createLogger } from "../shared/logger.js";
import type {
	AgentGuardrails,
	GuardrailDimension,
	GuardrailOutcome,
} from "./types.js";

type GuardrailsOptions = {
	agentId: string;
	session: RuntimeSession;
	config: AgentGuardrails;
	onOutcome?: (outcome: GuardrailOutcome) => void;
};

export type AgentGuardrailsHandle = {
	start: () => void;
	stop: () => void;
	dispose: () => void;
	getOutcomes: () => GuardrailOutcome[];
};

export const describeDimension = (dimension: GuardrailDimension): string => {
	switch (dimension) {
		case "timeout":
			return "wall clock timeout";
		case "input_tokens":
			return "input token budget";
		case "output_tokens":
			return "output token budget";
		case "tool_loop":
			return "repeated tool call limit";
		case "tool_failure":
			return "consecutive tool failure limit";
	}
};

export const describeUnit = (dimension: GuardrailDimension): string => {
	switch (dimension) {
		case "timeout":
			return "ms";
		case "input_tokens":
		case "output_tokens":
			return "tokens";
		case "tool_loop":
		case "tool_failure":
			return "calls";
	}
};

const stableStringify = (value: unknown): string => {
	if (value === null || typeof value !== "object") {
		return JSON.stringify(value) ?? "undefined";
	}
	if (Array.isArray(value)) {
		return `[${value.map(stableStringify).join(",")}]`;
	}
	const entries = Object.entries(value as Record<string, unknown>)
		.filter(([, entryValue]) => entryValue !== undefined)
		.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
	return `{${entries
		.map(
			([key, entryValue]) =>
				`${JSON.stringify(key)}:${stableStringify(entryValue)}`,
		)
		.join(",")}}`;
};

const softWarningMessage = (
	dimension: GuardrailDimension,
	limit: number,
	observed: number,
	toolName?: string,
): string => {
	if (dimension === "tool_loop" || dimension === "tool_failure") {
		const tool = toolName ? `"${toolName}"` : "the same tool";
		const reason =
			dimension === "tool_loop"
				? `You have called ${tool} with identical arguments ${observed} times in a row without making progress.`
				: `You have called ${tool} and it has failed ${observed} times in a row.`;

		return [
			reason,
			"Stop repeating this call.",
			"Rethink how you are using the tool. Change your arguments, use a different tool, or take a different approach.",
		].join(" ");
	}

	const observedText =
		dimension === "timeout"
			? `${Math.round(observed)} ms`
			: `${observed} tokens`;
	const limitText = dimension === "timeout" ? `${limit} ms` : `${limit} tokens`;

	return [
		`You are approaching the ${describeDimension(dimension)} (${observedText} of ${limitText}).`,
		"Finish your task with the data you already have and stop investigating.",
	].join(" ");
};

export const createGuardrails = ({
	agentId,
	session,
	config,
	onOutcome,
}: GuardrailsOptions): AgentGuardrailsHandle => {
	const log = createLogger({ agentId });
	const outcomes: GuardrailOutcome[] = [];
	const warned = new Set<GuardrailDimension>();
	let terminated = false;
	let started = false;
	let startedAt = 0;
	let inputTokens = 0;
	let outputTokens = 0;
	let lastSignature: string | undefined;
	let identicalCount = 0;
	let lastFailedTool: string | undefined;
	let failureCount = 0;
	let softTimer: NodeJS.Timeout | undefined;
	let hardTimer: NodeJS.Timeout | undefined;
	let unsubscribe: (() => void) | undefined;

	const record = (outcome: GuardrailOutcome): void => {
		outcomes.push(outcome);
		onOutcome?.(outcome);
	};

	const warn = (
		dimension: GuardrailDimension,
		limit: number,
		observed: number,
		toolName?: string,
	): void => {
		if (warned.has(dimension)) {
			return;
		}
		warned.add(dimension);

		const message = softWarningMessage(dimension, limit, observed, toolName);
		log.info("Guardrail soft limit reached", dimension, `${observed}/${limit}`);

		if (session.isStreaming) {
			void session.steer(message);
		} else {
			log.debug(
				"Guardrail soft warning not delivered (session idle)",
				dimension,
			);
		}
	};

	const terminate = (
		dimension: GuardrailDimension,
		limit: number,
		observed: number,
		toolName?: string,
	): void => {
		if (terminated) {
			return;
		}
		terminated = true;

		const outcome: GuardrailOutcome = {
			dimension,
			limit,
			observed,
			terminated: true,
			...(toolName ? { toolName } : {}),
		};
		record(outcome);
		log.error(
			"Guardrail hard limit reached, aborting",
			dimension,
			`${observed}/${limit}`,
		);

		session.clearQueue();
		void session
			.abort()
			.catch(() => undefined)
			.then(() => {
				session.clearQueue();
			});
	};

	const checkBudget = (
		dimension: GuardrailDimension,
		budget: number,
		observed: number,
		toolName?: string,
	): void => {
		if (budget <= 0) {
			return;
		}
		if (observed >= budget) {
			terminate(dimension, budget, observed, toolName);
			return;
		}
		const softLimit = budget * config.softLimitRatio;
		if (softLimit > 0 && observed >= softLimit) {
			warn(dimension, budget, observed, toolName);
		}
	};

	const checkTokens = (): void => {
		if (terminated) {
			return;
		}
		checkBudget("input_tokens", config.inputTokenBudget, inputTokens);
		checkBudget("output_tokens", config.outputTokenBudget, outputTokens);
	};

	const handleToolStart = (toolName: string, args: unknown): void => {
		if (terminated) {
			return;
		}
		const signature = `${toolName}:${stableStringify(args)}`;
		if (signature === lastSignature) {
			identicalCount += 1;
		} else {
			lastSignature = signature;
			identicalCount = 1;
		}
		checkBudget(
			"tool_loop",
			config.toolLoopThreshold,
			identicalCount,
			toolName,
		);
	};

	const handleToolEnd = (toolName: string, isError: boolean): void => {
		if (terminated) {
			return;
		}
		if (!isError) {
			lastFailedTool = undefined;
			failureCount = 0;
			return;
		}
		if (toolName === lastFailedTool) {
			failureCount += 1;
		} else {
			lastFailedTool = toolName;
			failureCount = 1;
		}
		checkBudget(
			"tool_failure",
			config.toolFailureThreshold,
			failureCount,
			toolName,
		);
	};

	const handleEvent = (event: AgentRuntimeEvent): void => {
		if (event.type === "tool_execution_start") {
			handleToolStart(event.toolName, event.args);
			return;
		}
		if (event.type === "tool_execution_end") {
			handleToolEnd(event.toolName, event.isError);
			return;
		}
		if (event.type !== "message_end" || event.role !== "assistant") {
			return;
		}
		const usage = event.usage;
		if (!usage) {
			return;
		}
		inputTokens += usage.input;
		outputTokens += usage.output;
		checkTokens();
	};

	const start = (): void => {
		if (started) {
			return;
		}
		started = true;
		startedAt = Date.now();

		unsubscribe = session.subscribe(handleEvent);

		if (config.timeoutMs > 0) {
			const elapsed = (): number => Date.now() - startedAt;
			const softLimitMs = config.timeoutMs * config.softLimitRatio;

			if (softLimitMs > 0 && softLimitMs < config.timeoutMs) {
				softTimer = setTimeout(() => {
					if (terminated) {
						return;
					}
					const observed = elapsed();
					if (observed >= config.timeoutMs) {
						return;
					}
					warn("timeout", config.timeoutMs, observed);
				}, softLimitMs);
			}

			hardTimer = setTimeout(() => {
				if (terminated) {
					return;
				}
				terminate("timeout", config.timeoutMs, elapsed());
			}, config.timeoutMs);
		}
	};

	const clearTimers = (): void => {
		if (softTimer) {
			clearTimeout(softTimer);
			softTimer = undefined;
		}
		if (hardTimer) {
			clearTimeout(hardTimer);
			hardTimer = undefined;
		}
	};

	const stop = (): void => {
		clearTimers();
	};

	const dispose = (): void => {
		stop();
		unsubscribe?.();
		unsubscribe = undefined;
	};

	return {
		start,
		stop,
		dispose,
		getOutcomes: () => [...outcomes],
	};
};
