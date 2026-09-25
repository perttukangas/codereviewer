import { getAgentConfig } from "../../../engine/agent-config.js";
import { runGuardedSession } from "../../../engine/session.js";
import type { Agent } from "../../../engine/types.js";
import type { WorkflowContext } from "../../types.js";
import { formatReviewPrompt } from "../prompt.js";
import { nextId } from "../tools/review-finding/index.js";
import { createReviewFindingTool } from "../tools/submit-review-finding.js";
import type { AgentReview } from "../types.js";
import { toGuardrailError } from "./errors.js";

export const reviewAgent = async (
	context: WorkflowContext,
	agent: Agent,
	repositoryDir: string,
	diff: string,
	review: AgentReview,
): Promise<void> => {
	const reviewFindingTool = createReviewFindingTool(
		agent,
		repositoryDir,
		review.findings,
	);

	const outcomes = await runGuardedSession({
		agent,
		runtime: context.runtime,
		config: getAgentConfig(agent),
		customTools: [reviewFindingTool],
		output: review,
		prompt: formatReviewPrompt(agent, diff),
	});

	for (const outcome of outcomes) {
		review.errors.push(
			toGuardrailError(
				nextId(review.errors, `${agent.id}:error`),
				agent.id,
				outcome,
			),
		);
	}
};
