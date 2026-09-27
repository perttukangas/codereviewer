import { createLogger, error } from "../shared/logger.js";
import { describeDimension, describeUnit } from "./guardrails/index.js";
import type {
	GuardrailOutcome,
	WorkflowGuardrailError,
	WorkflowUnhandledError,
} from "./types.js";

export const toGuardrailError = (
	id: string,
	agentId: string,
	outcome: GuardrailOutcome,
): WorkflowGuardrailError => {
	const dimension = describeDimension(outcome.dimension);
	const unit = describeUnit(outcome.dimension);
	const tool = outcome.toolName ? ` "${outcome.toolName}"` : "";

	const guardrailError: WorkflowGuardrailError = {
		id,
		agentId,
		kind: "guardrail",
		dimension: outcome.dimension,
		limit: outcome.limit,
		observed: outcome.observed,
		message: `The agent reached the ${dimension}${tool} (${outcome.observed} of ${outcome.limit} ${unit}) and was terminated before completing.`,
	};

	createLogger({ agentId }).error(guardrailError.message);
	return guardrailError;
};

const describeCause = (
	cause: unknown,
): { name: string; message: string; stack?: string } => {
	if (cause instanceof Error) {
		return {
			name: cause.name,
			message: cause.message,
			...(cause.stack ? { stack: cause.stack } : {}),
		};
	}

	return { name: "UnknownError", message: String(cause) };
};

export const toUnhandledError = (
	id: string,
	cause: unknown,
): WorkflowUnhandledError => {
	const { name, message, stack } = describeCause(cause);

	const unhandledError: WorkflowUnhandledError = {
		id,
		kind: "unhandled_exception",
		name,
		message,
		...(stack ? { stack } : {}),
	};

	error(stack ?? `${name}: ${message}`);
	return unhandledError;
};
