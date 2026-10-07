import { createLogger, error } from "../shared/logger.js";
import { describeDimension, describeUnit } from "./guardrails/index.js";
import type {
	GuardrailOutcome,
	WorkflowGuardrailError,
	WorkflowGuardrailWarning,
	WorkflowUnhandledError,
} from "./types.js";

const describeGuardrail = (
	outcome: GuardrailOutcome,
): { dimension: string; unit: string; tool: string } => ({
	dimension: describeDimension(outcome.dimension),
	unit: describeUnit(outcome.dimension),
	tool: outcome.toolName ? ` ${outcome.toolName}` : "",
});

export const toGuardrailError = (
	id: string,
	agentId: string,
	outcome: GuardrailOutcome,
): WorkflowGuardrailError => {
	const { dimension, unit, tool } = describeGuardrail(outcome);

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

export const toGuardrailWarning = (
	id: string,
	agentId: string,
	outcome: GuardrailOutcome,
): WorkflowGuardrailWarning => {
	const { dimension, unit, tool } = describeGuardrail(outcome);

	const warning: WorkflowGuardrailWarning = {
		id,
		agentId,
		kind: "soft-guardrail",
		dimension: outcome.dimension,
		limit: outcome.limit,
		observed: outcome.observed,
		message: `The agent approached the ${dimension}${tool} (${outcome.observed} of ${outcome.limit} ${unit}) and received a warning.`,
	};

	createLogger({ agentId }).info(warning.message);
	return warning;
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
