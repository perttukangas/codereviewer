import { Type } from "typebox";
import type {
	ReviewCodeChange,
	ReviewFinding,
	ReviewSeverity,
	ReviewSuggestedChange,
} from "../../types.js";

export const severityValues = [
	"critical",
	"high",
	"medium",
	"low",
	"info",
] as const;

export const severityRank = (severity: ReviewSeverity): number =>
	severityValues.indexOf(severity);

export type ReviewCodeChangeInput = Omit<
	ReviewCodeChange,
	"startLine" | "endLine"
>;
export type ReviewSuggestedChangeInput = Omit<
	ReviewSuggestedChange,
	"codeChange"
> & {
	codeChange?: ReviewCodeChangeInput;
};
export type ReviewFindingInput = Omit<
	ReviewFinding,
	"id" | "suggestedChange"
> & {
	suggestedChange: ReviewSuggestedChangeInput;
};

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
	"Use severity critical, high, medium, low, or info according to impact, and set confidence from 0 to 1 according to evidence strength.",
	"Shared severity rubric: CRITICAL means an active or highly likely issue with severe impact that should block release or immediate merge. HIGH means significant risk with clear impact and high confidence that should be fixed before release or in the current change window. MEDIUM means an important issue with meaningful impact that is not release-blocking by itself. LOW means a minor but actionable issue with limited impact. INFO means an improvement note or clarification with minimal direct risk.",
	"Use code change suggestion for small, localized issues when you can suggest a concrete code fix, even if you are not entirely confident it is the intended solution.",
	"Use suggested change file paths array to provide every repository-relative file relevant to understanding or fixing the finding, including callers, definitions, configuration, and tests where applicable.",
];

export const reviewCodeChangeSchema = Type.Object({
	filePath: Type.String({
		minLength: 1,
		description: "Repository-relative path of the file to change.",
	}),
	oldText: Type.String({
		minLength: 1,
		description: "Exact text that must occur once in the current file.",
	}),
	newText: Type.String({
		description:
			"Text that replaces the exact oldText. Use an empty string for deletion.",
	}),
});

export const reviewSuggestedChangeSchema = Type.Object({
	filePaths: Type.Array(
		Type.String({
			minLength: 1,
			description: "Repository-relative path of the file.",
		}),
		{
			minItems: 1,
			description:
				"Every repository-relative file relevant to understanding or fixing the finding, including callers, definitions, configuration, and tests where applicable.",
		},
	),
	explanation: Type.String({
		minLength: 1,
		description:
			"Describe the suggested change. For multi-step or broad changes, describe the full approach here.",
	}),
	codeChange: Type.Optional(reviewCodeChangeSchema),
});

export const reviewFindingSchema = Type.Object({
	title: Type.String({
		minLength: 1,
		description: "Short, specific title describing the review finding.",
	}),
	severity: Type.Enum(severityValues, {
		description:
			"Impact level. Use CRITICAL, HIGH, MEDIUM, LOW, or INFO according to the shared severity rubric.",
	}),
	confidence: Type.Number({
		minimum: 0,
		maximum: 1,
		description:
			"Evidence confidence from 0 to 1. Use 1 for directly demonstrated issues and lower values when assumptions remain.",
	}),
	problem: Type.String({
		minLength: 1,
		description: "What is wrong, including the relevant failure or risk.",
	}),
	suggestedChange: reviewSuggestedChangeSchema,
	rationale: Type.String({
		minLength: 1,
		description:
			"Why the suggested change is appropriate and what impact it addresses.",
	}),
});
