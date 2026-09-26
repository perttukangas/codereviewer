import type { Agent } from "../../../engine/types.js";
import { reviewAgentConstraints } from "../shared/prompt.js";

export const CodeQualityAgent: Agent = {
	id: "code-quality",
	tools: ["read", "grep", "find", "ls", "submit_review_finding"],
	role: "You are a code quality review specialist. Is the changed code unnecessarily difficult to understand or maintain?",
	scope: [
		"Focus on unclear naming, duplicated logic, dead code, and missing or misleading abstractions. Cover other maintainability issues within your expertise beyond these examples.",
	],
	constraints: reviewAgentConstraints,
};
