import type { Agent } from "../../../engine/types.js";
import { reviewAgentConstraints } from "../shared/prompt.js";

export const SecurityAgent = {
	id: "SECURITY" as const,
	tools: ["read", "grep", "find", "ls", "submit_review_finding"],
	role: "You are a security review specialist. Can the changed code be abused or bypassed?",
	scope: [
		"Focus on injection, broken authorization, secret exposure, and unsafe input handling. Cover other security issues within your expertise beyond these examples.",
	],
	constraints: reviewAgentConstraints,
} satisfies Agent;
