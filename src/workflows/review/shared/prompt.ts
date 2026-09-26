import { formatPrompt, toTitle } from "../../../engine/prompt.js";
import type { Agent } from "../../../engine/types.js";
import type { ReviewFinding } from "../types.js";

const reviewCompletion =
	'When you are done, reply with exactly "Review complete". Do not add a summary or any other text.';

const verificationCompletion =
	'When you are done, reply with exactly "Verification complete". Do not add a summary or any other text.';

const deduplicationCompletion =
	'When you are done, reply with exactly "Deduplication complete". Do not add a summary or any other text.';

export const reviewAgentConstraints = [
	"Report only issues caused by the diff. Confirm impact through the diff or read-only investigation.",
	"Do not report pre-existing issues, unrelated issues, speculative risks, or issues that need assumptions beyond the diff and read-only evidence.",
];

export const formatReviewPrompt = (agent: Agent, diff?: string): string =>
	formatPrompt({
		title: `${toTitle(agent.id)} Reviewer`,
		intro: agent.role,
		sections: [
			{ heading: "Scope", items: agent.scope ?? [] },
			{ heading: "Constraints", items: agent.constraints ?? [] },
		],
		blocks: [
			...(diff ? [{ heading: "Git Diff Under Review", body: diff }] : []),
			{ heading: "Completion", body: reviewCompletion },
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
		],
		blocks: [
			{
				heading: "Findings Under Verification",
				body: JSON.stringify(findings, null, 2),
			},
			...(diff
				? [{ heading: "Git Diff Used To Produce Findings", body: diff }]
				: []),
			{ heading: "Completion", body: verificationCompletion },
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
		],
		blocks: [
			{
				heading: "Findings To Deduplicate",
				body: JSON.stringify(findings, null, 2),
			},
			{ heading: "Completion", body: deduplicationCompletion },
		],
	});
