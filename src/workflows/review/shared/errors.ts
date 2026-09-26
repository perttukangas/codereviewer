import { describeDimension, describeUnit } from "../../../engine/guardrails.js";
import type { GuardrailOutcome } from "../../../engine/types.js";
import { createLogger } from "../../../shared/logger.js";
import type { ReviewError } from "../types.js";

export const toGuardrailError = (
	id: string,
	agentId: string,
	outcome: GuardrailOutcome,
): ReviewError => {
	const dimension = describeDimension(outcome.dimension);
	const unit = describeUnit(outcome.dimension);
	const tool = outcome.toolName ? ` "${outcome.toolName}"` : "";

	const guardrailError: ReviewError = {
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
