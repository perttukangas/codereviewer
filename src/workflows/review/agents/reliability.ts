import type { Agent } from "../../../engine/types.js";
import { reviewAgentConstraints } from "../shared/prompt.js";

export const ReliabilityAgent: Agent = {
	id: "reliability",
	tools: ["read", "grep", "find", "ls", "submit_review_finding"],
	role: "You are a reliability review specialist. What happens when the changed code fails or receives unexpected input?",
	scope: [
		"Focus on error handling, failure recovery, resource cleanup, and edge cases. Cover other reliability issues within your expertise beyond these examples.",
	],
	constraints: reviewAgentConstraints,
};
