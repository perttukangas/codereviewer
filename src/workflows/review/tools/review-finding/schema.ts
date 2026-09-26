import { Type } from "typebox";
import type {
	ReviewCodeChange,
	ReviewFinding,
	ReviewSeverity,
	ReviewSuggestedChange,
} from "../../types.js";

export const severityValues = [
	"CRITICAL",
	"HIGH",
	"MEDIUM",
	"LOW",
	"INFO",
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
	"Set severity by impact. Set confidence from 0 to 1 by evidence strength.",
	"Severity rubric. CRITICAL blocks release or immediate merge. HIGH should be fixed before release or in the current change window. MEDIUM is important but not release-blocking alone. LOW is minor but actionable. INFO is an improvement note with minimal risk.",
	"Provide a code change for small, localized issues when you can suggest a concrete fix.",
	"List every repository-relative file relevant to understanding or fixing the finding, including callers, definitions, configuration, and tests.",
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
		description: "Text that replaces oldText. Use an empty string to delete.",
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
				"Every repository-relative file relevant to understanding or fixing the finding, including callers, definitions, configuration, and tests.",
		},
	),
	explanation: Type.String({
		minLength: 1,
		description:
			"Describe the suggested change. For broad or multi-step changes, describe the full approach.",
	}),
	codeChange: Type.Optional(reviewCodeChangeSchema),
});

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
	suggestedChange: reviewSuggestedChangeSchema,
	rationale: Type.String({
		minLength: 1,
		description:
			"Why the suggested change is appropriate and what impact it addresses.",
	}),
});
