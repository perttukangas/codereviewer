import type { Agent } from "../agent-runtime/types.js";

export const CodeQualityAgent: Agent = {
	id: "code-quality",
	tools: ["read", "grep", "find", "ls"],
	prompt: "You are a code quality review specialist.",
};
