import { getAgentConfig } from "../../../engine/agent-config.js";
import { runGuardedSession } from "../../../engine/session.js";
import type { Agent } from "../../../engine/types.js";
import { info } from "../../../platform/logger.js";
import type { WorkflowContext } from "../../types.js";
import { VerifierAgent } from "../agents/verifier.js";
import { formatVerificationPrompt } from "../prompt.js";
import { createEditReviewFindingTool } from "../tools/edit-review-finding.js";
import { nextId } from "../tools/review-finding/index.js";
import type { AgentReview } from "../types.js";
import { toGuardrailError } from "./errors.js";

export const verifyReview = async (
	context: WorkflowContext,
	reviewer: Agent,
	review: AgentReview,
	repositoryDir: string,
	diff: string,
): Promise<void> => {
	const eligible = review.findings;
	if (eligible.length === 0) {
		info("Skipping verification, no eligible findings to verify", reviewer.id);
		return;
	}

	const timerId = `${reviewer.id}:${VerifierAgent.id}`;
	const editFindingTool = createEditReviewFindingTool(
		repositoryDir,
		review.findings,
	);

	const outcomes = await runGuardedSession({
		agent: VerifierAgent,
		runtime: context.runtime,
		config: getAgentConfig(VerifierAgent),
		customTools: [editFindingTool],
		output: review,
		prompt: formatVerificationPrompt(VerifierAgent, reviewer, eligible, diff),
		timerId,
	});

	for (const outcome of outcomes) {
		review.errors.push(
			toGuardrailError(
				nextId(review.errors, `${timerId}:error`),
				VerifierAgent.id,
				outcome,
			),
		);
	}
};
