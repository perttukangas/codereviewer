import type { Agent } from "../agent-runtime/types.js";

export const PerformanceAgent: Agent = {
	id: "performance",
	tools: ["read", "grep", "find", "ls"],
	prompt: "You are a performance review specialist.",
};
