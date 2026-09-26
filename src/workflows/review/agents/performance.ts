import type { Agent } from "../../../engine/types.js";
import { reviewAgentConstraints } from "../shared/prompt.js";

export const PerformanceAgent: Agent = {
	id: "performance",
	tools: ["read", "grep", "find", "ls", "submit_review_finding"],
	role: "You are a performance review specialist. Does the changed code do unnecessary or expensive work?",
	scope: [
		"Focus on redundant work, inefficient algorithms, unnecessary allocations, and blocking calls. Cover other performance issues within your expertise beyond these examples.",
	],
	constraints: reviewAgentConstraints,
};
