import { formatPrompt, toTitle } from "../../engine/prompt.js";
import type { Agent } from "../../engine/types.js";

export const formatReviewPrompt = (agent: Agent, diff?: string): string =>
	formatPrompt({
		title: `${toTitle(agent.id)} Reviewer`,
		intro: agent.role,
		sections: [
			{ heading: "Scope", items: agent.scope ?? [] },
			{ heading: "Constraints", items: agent.constraints ?? [] },
		],
		blocks: diff ? [{ heading: "Git Diff", body: diff }] : [],
	});
