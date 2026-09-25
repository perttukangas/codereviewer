import { formatPrompt, toTitle } from "../../engine/prompt.js";
import type { Agent } from "../../engine/types.js";
import type { ReviewFinding } from "./types.js";

export const formatReviewPrompt = (agent: Agent, diff?: string): string =>
	formatPrompt({
		title: `${toTitle(agent.id)} Reviewer`,
		intro: agent.role,
		sections: [
			{ heading: "Scope", items: agent.scope ?? [] },
			{ heading: "Constraints", items: agent.constraints ?? [] },
		],
		blocks: diff ? [{ heading: "Git Diff Under Review", body: diff }] : [],
	});

export const formatVerificationPrompt = (
	verifier: Agent,
	reviewer: Agent,
	findings: ReviewFinding[],
	diff?: string,
): string =>
	formatPrompt({
		title: "Review Verification",
		intro: `${verifier.role} The findings below were produced by the ${reviewer.id} reviewer.`,
		blocks: [
			{
				heading: "Findings Under Verification",
				body: JSON.stringify(findings, null, 2),
			},
			...(diff
				? [{ heading: "Git Diff Used To Produce Findings", body: diff }]
				: []),
		],
	});
