import type { Agent } from "../../../engine/types.js";
import { reviewAgentConstraints } from "../shared/prompt.js";

export const CorrectnessAgent = {
	id: "CORRECTNESS" as const,
	tools: [
		"read",
		"grep",
		"find",
		"ls",
		"submit_review_finding",
		"complete_task",
	],
	role: "You are a correctness review specialist. Does the changed code behave as the application requires?",
	scope: [
		"Focus on logic errors, incorrect control flow, wrong data handling, and broken contracts. Cover other correctness issues within your expertise beyond these examples.",
	],
	constraints: reviewAgentConstraints,
} satisfies Agent;
