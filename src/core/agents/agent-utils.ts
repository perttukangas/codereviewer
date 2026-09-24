import type { Agent } from "../types.js";

export const formatAgentPrompt = (agent: Agent, diff?: string) => {
	const title = agent.id
		.split("-")
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join(" ");
	const sections = [`# ${title} Reviewer`, agent.role];

	if (agent.scope?.length) {
		sections.push(
			"## Scope",
			agent.scope.map((item) => `- ${item}`).join("\n"),
		);
	}

	if (agent.constraints?.length) {
		sections.push(
			"## Constraints",
			agent.constraints.map((item) => `- ${item}`).join("\n"),
		);
	}

	if (diff) {
		sections.push("## Git Diff", diff);
	}
	return sections.join("\n\n");
};
