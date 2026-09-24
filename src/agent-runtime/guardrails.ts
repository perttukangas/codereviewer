import type {
	AgentSessionEvent,
	AgentSession as PiAgentSession,
} from "@earendil-works/pi-coding-agent";

import { debug, error, info } from "../utils/logger.js";
import type {
	AgentGuardrails,
	GuardrailDimension,
	GuardrailOutcome,
} from "./types.js";

type GuardrailsOptions = {
	agentId: string;
	session: PiAgentSession;
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
	}
};

const softWarningMessage = (
	dimension: GuardrailDimension,
	limit: number,
	observed: number,
): string => {
	const observedText =
		dimension === "timeout"
			? `${Math.round(observed)} ms`
			: `${observed} tokens`;
	const limitText = dimension === "timeout" ? `${limit} ms` : `${limit} tokens`;

	return [
		`You are approaching the ${describeDimension(dimension)} (${observedText} of ${limitText}).`,
		"Wrap up now. Submit any findings you already have and stop investigating.",
	].join(" ");
};

export const createGuardrails = ({
	agentId,
	session,
	config,
	onOutcome,
}: GuardrailsOptions): AgentGuardrailsHandle => {
	const outcomes: GuardrailOutcome[] = [];
	const warned = new Set<GuardrailDimension>();
	let terminated = false;
	let started = false;
	let startedAt = 0;
	let inputTokens = 0;
	let outputTokens = 0;
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
	): void => {
		if (warned.has(dimension)) {
			return;
		}
		warned.add(dimension);

		const message = softWarningMessage(dimension, limit, observed);
		info(
			"Guardrail soft limit reached",
			agentId,
			dimension,
			`${observed}/${limit}`,
		);

		if (session.isStreaming) {
			void session.steer(message);
		} else {
			debug(
				"Guardrail soft warning not delivered (session idle)",
				agentId,
				dimension,
			);
		}
	};

	const terminate = (
		dimension: GuardrailDimension,
		limit: number,
		observed: number,
	): void => {
		if (terminated) {
			return;
		}
		terminated = true;

		record({ dimension, limit, observed, terminated: true });
		error(
			"Guardrail hard limit reached, aborting",
			agentId,
			dimension,
			`${observed}/${limit}`,
		);

		session.clearQueue();
		session.dispose;
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
	): void => {
		if (budget <= 0) {
			return;
		}
		if (observed >= budget) {
			terminate(dimension, budget, observed);
			return;
		}
		const softLimit = budget * config.softLimitRatio;
		if (softLimit > 0 && observed >= softLimit) {
			warn(dimension, budget, observed);
		}
	};

	const checkTokens = (): void => {
		if (terminated) {
			return;
		}
		checkBudget("input_tokens", config.inputTokenBudget, inputTokens);
		checkBudget("output_tokens", config.outputTokenBudget, outputTokens);
	};

	const handleEvent = (event: AgentSessionEvent): void => {
		if (event.type !== "message_end" || event.message.role !== "assistant") {
			return;
		}
		const usage = event.message.usage;
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
