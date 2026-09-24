import type { Agent } from "../../../engine/types.js";

export const CodeQualityAgent: Agent = {
	id: "code-quality",
	tools: ["read", "grep", "find", "ls", "submit_review_finding"],
	role: "You are a code quality review specialist.",
};
