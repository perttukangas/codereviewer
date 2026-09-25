import { getAgentConfig } from "../../../engine/agent-config.js";
import { runGuardedSession } from "../../../engine/session.js";
import type { Agent } from "../../../engine/types.js";
import type { WorkflowContext } from "../../types.js";
import { formatReviewPrompt } from "../prompt.js";
import { nextId } from "../tools/review-finding/index.js";
import { createReviewFindingTool } from "../tools/submit-review-finding.js";
import type { AgentReview, ReviewRunState } from "../types.js";
import { toGuardrailError } from "./errors.js";

export const reviewAgent = async (
	context: WorkflowContext,
	agent: Agent,
	repositoryDir: string,
	diff: string,
	review: AgentReview,
	run: ReviewRunState,
): Promise<void> => {
	const reviewFindingTool = createReviewFindingTool(
		agent,
		repositoryDir,
		review.findings,
	);

	const response = await runGuardedSession({
		agent,
		runtime: context.runtime,
		config: getAgentConfig(agent),
		customTools: [reviewFindingTool],
		output: review,
		prompt: formatReviewPrompt(agent, diff),
	});

	run.telemetry.record(agent.id, response.durationMs, response.usage);

	for (const outcome of response.guardrails.filter(
		(guardrail) => guardrail.terminated,
	)) {
		run.errors.push(
			toGuardrailError(
				nextId(run.errors, `${agent.id}:error`),
				agent.id,
				outcome,
			),
		);
	}
};
