import type { Agent } from "../../../engine/types.js";

export const PerformanceAgent: Agent = {
	id: "performance",
	tools: ["read", "grep", "find", "ls", "submit_review_finding"],
	role: "You are a performance review specialist.",
};
