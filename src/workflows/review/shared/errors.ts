import { describeDimension } from "../../../engine/guardrails.js";
import type { Agent, GuardrailOutcome } from "../../../engine/types.js";
import { error } from "../../../shared/logger.js";
import type { ReviewError } from "../types.js";

export const toGuardrailError = (
	id: string,
	agentId: string,
	outcome: GuardrailOutcome,
): ReviewError => {
	const dimension = describeDimension(outcome.dimension);
	const unit = outcome.dimension === "timeout" ? "ms" : "tokens";

	const guardrailError: ReviewError = {
		id,
		agentId,
		kind: "guardrail",
		dimension: outcome.dimension,
		limit: outcome.limit,
		observed: outcome.observed,
		message: `The agent reached the ${dimension} of ${outcome.limit} ${unit} (observed ${outcome.observed} ${unit}) and was terminated before completing the review. Findings reported here may be incomplete.`,
	};

	error(guardrailError.id, guardrailError.agentId, guardrailError.message);
	return guardrailError;
};

export const toReviewError = (
	id: string,
	agent: Agent,
	cause: unknown,
): ReviewError => {
	const message = cause instanceof Error ? cause.message : String(cause);

	const reviewError: ReviewError = {
		id,
		agentId: agent.id,
		kind: "error",
		message: `The ${agent.id} review agent failed before completing its review. Any findings reported here may be incomplete. Error: ${message}`,
	};

	error(reviewError.id, reviewError.agentId, reviewError.message);
	return reviewError;
};
