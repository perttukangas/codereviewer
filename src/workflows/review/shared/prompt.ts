import { formatPrompt, toTitle } from "../../../engine/prompt.js";
import type { Agent } from "../../../engine/types.js";
import type { ReviewFinding } from "../types.js";
import { orderFindingsForPrompt } from "./findings-order.js";

const reviewCompletion =
	'When you are done, reply with exactly "Review complete". Do not add a summary or any other text.';

const verificationCompletion =
	'When you are done, reply with exactly "Verification complete". Do not add a summary or any other text.';

const deduplicationCompletion =
	'When you are done, reply with exactly "Deduplication complete". Do not add a summary or any other text.';

export const reviewFindingRubric = [
	"Severity rubric. CRITICAL blocks release or immediate merge. HIGH should be fixed before release or in the current change window. MEDIUM is important but not release-blocking alone. LOW is minor but actionable. INFO is an improvement note with minimal risk.",
	"Confidence rubric. 1.0 is directly demonstrated by the code or diff with no assumptions. 0.8 is strong evidence with minor assumptions. 0.5 is plausible but unverified. 0.2 is speculative.",
];

export const reviewAgentConstraints = [
	"Report only issues caused by the diff. Confirm impact through the diff or read-only investigation.",
	"Do not report pre-existing issues, unrelated issues, speculative risks, or issues that need assumptions beyond the diff and read-only evidence.",
	...reviewFindingRubric,
];

export const reviewApproach = [
	"Scan the entire diff before investigating individual changes.",
	"Identify the changes most likely to matter for your role and scope.",
	"Investigate those changes first.",
	"Do not let prioritization cause you to ignore lower-impact changes or valid findings.",
];

export const formatReviewPrompt = (agent: Agent, diff?: string): string =>
	formatPrompt({
		title: `${toTitle(agent.id)} Reviewer`,
		intro: agent.role,
		sections: [
			{ heading: "Approach", items: reviewApproach },
			{ heading: "Scope", items: agent.scope ?? [] },
			{ heading: "Constraints", items: agent.constraints ?? [] },
			{ heading: "Completion", items: [reviewCompletion] },
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
			{ heading: "Completion", items: [verificationCompletion] },
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
			{ heading: "Completion", items: [deduplicationCompletion] },
		],
		blocks: [
			{
				heading: "Findings To Deduplicate",
				body: JSON.stringify(orderFindingsForPrompt(findings), null, 2),
			},
		],
	});
