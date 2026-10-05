import { formatPrompt, toTitle } from "../../../engine/prompt.js";
import type { Agent } from "../../../engine/types.js";
import type { ReviewFinding } from "../types.js";
import { orderFindingsForPrompt } from "./findings.js";

const completionInstruction = [
	"When you are done, call the complete_task tool as your final action. Do not add a summary or any other text.",
];

export const reviewFindingRubric = [
	"Severity rubric. CRITICAL blocks release or immediate merge. HIGH should be fixed before release or in the current change window. MEDIUM is important but not release-blocking alone. LOW is minor but actionable. INFO is an improvement note with minimal risk.",
	"Confidence rubric. DEMONSTRATED is directly shown by the code or diff with no assumptions. STRONG is supported by solid evidence with minor assumptions. PLAUSIBLE is consistent with the evidence but not verified. SPECULATIVE is a guess with little or no supporting evidence.",
];

export const reviewAgentConstraints = [
	"Report only issues caused by the diff, directly or indirectly. Do not report pre-existing or unrelated issues. Confirm each issue through the diff or read-only investigation.",
	"Avoid over-speculating. You may rely on well-established language, framework, and library behavior, but not on project-specific assumptions the diff and read-only evidence do not support.",
	...reviewFindingRubric,
];

export const reviewApproach = [
	"Scan the entire diff before investigating individual changes.",
	"Identify the changes most likely to matter for your role and scope.",
	"Investigate those changes first.",
	"Use the read-only tools to inspect relevant files when the diff alone is insufficient.",
	"Do not let prioritization cause you to ignore lower-impact changes or valid findings.",
];

export const formatReviewPrompt = (agent: Agent, diff?: string): string =>
	formatPrompt({
		title: `${toTitle(agent.id)} Reviewer`,
		intro: agent.role,
		sections: [
			{ heading: "Scope", items: agent.scope ?? [] },
			{ heading: "Constraints", items: agent.constraints ?? [] },
			{ heading: "Approach", items: reviewApproach },
			{ heading: "Completion", items: completionInstruction },
		],
		blocks: [
			...(diff ? [{ heading: "Git Diff Under Review", body: diff }] : []),
		],
	});

export const formatVerificationPrompt = (
	verifier: Agent,
	reviewer: Agent,
	findings: ReviewFinding[],
	diff?: string,
): string =>
	formatPrompt({
		title: "Review Verification",
		intro: `${verifier.role} The findings below were produced by the ${toTitle(reviewer.id)} reviewer.`,
		sections: [
			{ heading: "Scope", items: verifier.scope ?? [] },
			{ heading: "Constraints", items: verifier.constraints ?? [] },
			{ heading: "Completion", items: completionInstruction },
		],
		blocks: [
			{
				heading: "Findings Under Verification",
				body: JSON.stringify(orderFindingsForPrompt(findings), null, 2),
			},
			...(diff
				? [{ heading: "Git Diff Used To Produce Findings", body: diff }]
				: []),
		],
	});

export const formatDeduplicationPrompt = (
	deduplicator: Agent,
	findings: ReviewFinding[],
): string =>
	formatPrompt({
		title: "Review Deduplication",
		intro: deduplicator.role,
		sections: [
			{ heading: "Scope", items: deduplicator.scope ?? [] },
			{ heading: "Constraints", items: deduplicator.constraints ?? [] },
			{ heading: "Completion", items: completionInstruction },
		],
		blocks: [
			{
				heading: "Findings To Deduplicate",
				body: JSON.stringify(orderFindingsForPrompt(findings), null, 2),
			},
		],
	});
