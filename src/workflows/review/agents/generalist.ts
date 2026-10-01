import type { Agent } from "../../../engine/types.js";
import { reviewAgentConstraints } from "../shared/prompt.js";
import { reviewAgents } from "./review-agents.js";

const roleQuestion = (agent: Agent): string =>
	agent.role.replace(/^You are a .*? specialist\.\s*/, "");

export const GeneralistAgent: Agent = {
	id: "generalist",
	tools: ["read", "grep", "find", "ls", "submit_review_finding"],
	role: `You are a generalist code review specialist covering every review scope. ${reviewAgents
		.map(roleQuestion)
		.join(" ")}`,
	scope: reviewAgents.flatMap((agent) => agent.scope ?? []),
	constraints: reviewAgentConstraints,
};
