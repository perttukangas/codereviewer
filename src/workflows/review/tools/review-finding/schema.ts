import { Type } from "typebox";
import type { ReviewFinding, ReviewSeverity } from "../../types.js";

export const severityValues = [
	"CRITICAL",
	"HIGH",
	"MEDIUM",
	"LOW",
	"INFO",
] as const;

export const severityRank = (severity: ReviewSeverity): number =>
	severityValues.indexOf(severity);

export type ReviewFindingInput = Omit<
	ReviewFinding,
	"id" | "codeChangeStartLine" | "codeChangeEndLine"
>;

export const nextId = (items: { id: string }[], prefix: string): string => {
	const idPrefix = `${prefix}-`;
	const highest = items.reduce((max, item) => {
		if (!item.id.startsWith(idPrefix)) {
			return max;
		}
		const suffix = Number.parseInt(item.id.slice(idPrefix.length), 10);
		return Number.isNaN(suffix) ? max : Math.max(max, suffix);
	}, 0);

	return `${idPrefix}${highest + 1}`;
};

export const reviewFindingGuidelines = [
	"Set severity by impact. Set confidence from 0 to 1 by evidence strength.",
	"Severity rubric. CRITICAL blocks release or immediate merge. HIGH should be fixed before release or in the current change window. MEDIUM is important but not release-blocking alone. LOW is minor but actionable. INFO is an improvement note with minimal risk.",
	"List every repository-relative file relevant to understanding or fixing the finding in relatedFiles, including callers, definitions, configuration, and tests.",
	"Use code change for small, localized fixes when you can suggest a concrete code change, even if you are not entirely confident it is the intended solution.",
	"Use suggested change to describe the fix. Do not include code.",
];

export const reviewFindingSchema = Type.Object({
	title: Type.String({
		minLength: 1,
		description: "Short, specific title describing the finding.",
	}),
	severity: Type.Enum(severityValues, {
		description: "Impact level. Use the shared severity rubric.",
	}),
	confidence: Type.Number({
		minimum: 0,
		maximum: 1,
		description:
			"Evidence confidence from 0 to 1. Use 1 for directly demonstrated issues and lower values when assumptions remain.",
	}),
	problem: Type.String({
		minLength: 1,
		description: "What is wrong, including the failure or risk.",
	}),
	suggestedChange: Type.String({
		minLength: 1,
		description: "Describe the fix. Do not include code.",
	}),
	relatedFiles: Type.Array(
		Type.String({
			minLength: 1,
			description:
				"Repository-relative path of a file relevant to understanding or fixing the finding.",
		}),
		{
			minItems: 1,
			description:
				"Every repository-relative file relevant to understanding or fixing the finding, including callers, definitions, configuration, and tests.",
		},
	),
	codeChangeFilePath: Type.Optional(
		Type.String({
			minLength: 1,
			description: "Repository-relative path of the file to change.",
		}),
	),
	codeChangeOldText: Type.Optional(
		Type.String({
			minLength: 1,
			description: "Exact text that must occur once in the current file.",
		}),
	),
	codeChangeNewText: Type.Optional(
		Type.String({
			description:
				"Text that replaces the exact codeChangeOldText. Use an empty string for deletion.",
		}),
	),
	rationale: Type.String({
		minLength: 1,
		description:
			"Why the suggested change and code change are appropriate and what impact they address.",
	}),
});
