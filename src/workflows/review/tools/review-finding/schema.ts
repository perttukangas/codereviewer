import { Type } from "typebox";
import { reviewCategoryValues } from "../../agents/review-agents.js";
import { confidenceValues, severityValues } from "../../shared/scoring.js";

export { reviewCategoryValues } from "../../agents/review-agents.js";
export {
	confidenceRank,
	confidenceValues,
	severityRank,
	severityValues,
} from "../../shared/scoring.js";

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

export const codeChangeGuideline =
	"When you set code change, copy codeChangeOldText verbatim from the current file, including all whitespace and newlines, and include enough surrounding context so the text occurs exactly once.";

export const mergeCodeChangeGuideline =
	"When you set code change, copy codeChangeFilePath, codeChangeOldText, and codeChangeNewText exactly from one of the findings being merged. Do not modify them. Omit all three when no source finding's code change can be used as is.";

export const reviewFindingGuidelines = [
	"Use code change for small, localized fixes when you can suggest a concrete code change, even if you are not entirely confident it is the intended solution.",
	codeChangeGuideline,
];

export const categoriesDescription =
	"Every review category the finding belongs to. Use more than one category when the finding spans several.";

export const categoriesParam = Type.Optional(
	Type.Array(Type.Enum(reviewCategoryValues), {
		minItems: 1,
		description: categoriesDescription,
	}),
);

export const requiredCategoriesParam = Type.Array(
	Type.Enum(reviewCategoryValues),
	{
		minItems: 1,
		description: categoriesDescription,
	},
);

export const reviewFindingSchema = Type.Object({
	title: Type.String({
		minLength: 1,
		description: "Short, specific title describing the finding.",
	}),
	severity: Type.Enum(severityValues, {
		description: "Impact level of the finding.",
	}),
	confidence: Type.Enum(confidenceValues, {
		description:
			"Confidence level that the finding is a true positive, meaning the issue is real and correctly described.",
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
			"Why the suggested change and code change are appropriate, what impact they address, and any assumptions the finding relies on.",
	}),
});
