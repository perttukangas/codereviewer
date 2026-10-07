import type { AgentRuntimeEvent } from "../../runtime/types.js";
import { createLogger } from "../../shared/logger.js";
import type { GuardrailDimension, GuardrailOutcome } from "../types.js";
import { softWarningMessage } from "./shared.js";
import { createTimeoutGuardrail } from "./timeout.js";
import { createTokenBudgetGuardrail } from "./token-budget.js";
import { createToolFailureGuardrail } from "./tool-failure.js";
import { createToolLoopGuardrail } from "./tool-loop.js";
import type {
	AgentGuardrailsHandle,
	Guardrail,
	GuardrailContext,
	GuardrailsOptions,
} from "./types.js";

export { describeDimension, describeUnit } from "./shared.js";
export type { AgentGuardrailsHandle } from "./types.js";

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
	let midStream = false;
	let unsubscribe: (() => void) | undefined;

	const record = (outcome: GuardrailOutcome): void => {
		outcomes.push(outcome);
		onOutcome?.(outcome);
	};

	const interrupt = (message: string): void => {
		log.info("Guardrail interrupt, aborting stream to deliver warning");
		void session
			.steer(message)
			.catch(() => undefined)
			.then(() => session.abort())
			.catch(() => undefined);
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

		if (!session.isStreaming) {
			log.debug(
				"Guardrail soft warning not delivered (session idle)",
				dimension,
			);
			return;
		}

		// Only timeout guardrail can interrupt mid-stream, other guardrails will wait until the message is complete
		if (dimension === "timeout" && midStream) {
			interrupt(message);
			return;
		}

		void session.steer(message);
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

	const context: GuardrailContext = {
		config,
		checkBudget,
		warn,
		interrupt,
		terminate,
		isTerminated: () => terminated,
	};

	const guardrails: Guardrail[] = [
		createTimeoutGuardrail(context),
		createTokenBudgetGuardrail(context),
		createToolLoopGuardrail(context),
		createToolFailureGuardrail(context),
	];

	const dispatch = (handler: (guardrail: Guardrail) => void): void => {
		if (terminated) {
			return;
		}
		for (const guardrail of guardrails) {
			handler(guardrail);
		}
	};

	const handleEvent = (event: AgentRuntimeEvent): void => {
		switch (event.type) {
			case "agent_start":
			case "agent_end":
			case "turn_start":
			case "turn_end":
				midStream = false;
				return;

			case "message_update":
				if (event.role === "assistant") {
					midStream = true;
				}
				return;

			case "tool_execution_start":
				midStream = false;
				dispatch((guardrail) =>
					guardrail.onToolStart?.(event.toolName, event.args),
				);
				return;

			case "tool_execution_end":
				dispatch((guardrail) =>
					guardrail.onToolEnd?.(event.toolName, event.isError),
				);
				return;

			case "message_end": {
				if (event.role !== "assistant") {
					return;
				}
				midStream = false;
				const usage = event.usage;
				if (!usage) {
					return;
				}
				dispatch((guardrail) =>
					guardrail.onUsage?.(usage.input, usage.output, usage.cacheRead),
				);
				return;
			}
		}
	};

	const start = (): void => {
		if (started) {
			return;
		}
		started = true;

		unsubscribe = session.subscribe(handleEvent);
		for (const guardrail of guardrails) {
			guardrail.start?.();
		}
	};

	const stop = (): void => {
		for (const guardrail of guardrails) {
			guardrail.stop?.();
		}
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
		isTerminated: () => terminated,
	};
};
