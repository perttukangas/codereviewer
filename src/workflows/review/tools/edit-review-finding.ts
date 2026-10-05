import { type Static, type TSchema, Type } from "typebox";
import { defineTool, toolResult } from "../../../engine/tools/index.js";
import type {
	ReviewCategory,
	ReviewCodeChangeFields,
	ReviewFinding,
} from "../types.js";
import {
	categoriesParam,
	prepareFindingArguments,
	reviewFindingGuidelines,
	reviewFindingSchema,
	validateFinding,
} from "./review-finding/index.js";

type EditFindingParams = Partial<Static<typeof reviewFindingSchema>> & {
	id: string;
	invalidReason?: string;
	categories?: ReviewCategory[];
};

const resolveCodeChange = (
	changes: Partial<ReviewCodeChangeFields>,
	base: ReviewFinding,
): Partial<ReviewCodeChangeFields> => {
	const provided = [
		changes.codeChangeFilePath,
		changes.codeChangeOldText,
		changes.codeChangeNewText,
	].filter((value) => value !== undefined).length;

	if (provided === 0) {
		return {
			codeChangeFilePath: base.codeChangeFilePath,
			codeChangeOldText: base.codeChangeOldText,
			codeChangeNewText: base.codeChangeNewText,
		};
	}

	if (provided !== 3) {
		throw new Error(
			"Provide codeChangeFilePath, codeChangeOldText, and codeChangeNewText together, or omit all three. To clear the concrete edit, provide all three as empty strings.",
		);
	}

	const allEmpty =
		(changes.codeChangeFilePath ?? "").trim() === "" &&
		(changes.codeChangeOldText ?? "").trim() === "" &&
		(changes.codeChangeNewText ?? "").trim() === "";

	if (allEmpty) {
		return {};
	}

	return {
		codeChangeFilePath: changes.codeChangeFilePath,
		codeChangeOldText: changes.codeChangeOldText,
		codeChangeNewText: changes.codeChangeNewText,
	};
};

const editGuidelines = [
	"When using edit_review_finding provide only the fields that need correction. Omitted fields keep their current values.",
	"To edit code changes, provide codeChangeFilePath, codeChangeOldText, and codeChangeNewText together. To clear it, provide all three as empty strings.",
	"A finding already marked invalid cannot be edited. Clear invalidReason with an empty string before editing its fields.",
	"Use the finding id from the findings under verification. Do not invent identifiers.",
	...reviewFindingGuidelines,
];

const idParam = Type.String({
	description: "String identifier of the finding.",
});

const invalidReasonParam = Type.Optional(
	Type.String({
		description:
			"Reason the finding is invalid. Provide a non-empty reason to mark the finding invalid. Provide an empty string to clear an existing invalidReason. Do not combine with field changes.",
	}),
);

const buildEditTool = (
	repoDir: string,
	findings: ReviewFinding[],
	parameters: TSchema,
	guidelines: string[],
	resolveCategories: (
		params: EditFindingParams,
		base: ReviewFinding,
	) => ReviewCategory[] | undefined,
) => {
	return defineTool({
		name: "edit_review_finding",
		label: "Edit Review Finding",
		description: "Edit an existing review finding by id, or mark it invalid.",
		promptSnippet: "Edit an existing review finding by id",
		promptGuidelines: guidelines,
		parameters,
		prepareArguments: prepareFindingArguments,
		executionMode: "sequential",
		async execute(_toolCallId, params) {
			const { id, invalidReason, categories, ...changes } =
				params as EditFindingParams;
			const index = findings.findIndex((finding) => finding.id === id);
			if (index === -1) {
				throw new Error(`Unknown review finding id: ${id}`);
			}

			const existing = findings[index];
			const hasOtherChanges =
				categories !== undefined ||
				Object.values(changes).some((value) => value !== undefined);
			const markingInvalid =
				invalidReason !== undefined && invalidReason.trim() !== "";
			const clearing =
				invalidReason !== undefined && invalidReason.trim() === "";

			if (markingInvalid && hasOtherChanges) {
				throw new Error("Use either invalidReason or field changes, not both.");
			}

			if (
				existing.invalidReason !== undefined &&
				!clearing &&
				hasOtherChanges
			) {
				throw new Error(
					"This finding is marked invalid. Clear invalidReason with an empty string before editing its fields.",
				);
			}

			if (markingInvalid) {
				const updated: ReviewFinding = { ...existing, invalidReason };
				findings[index] = updated;

				return toolResult(
					`Review finding ${updated.id} marked invalid.`,
					updated,
				);
			}

			const base: ReviewFinding = { ...existing };
			if (clearing) {
				delete base.invalidReason;
			}

			if (!hasOtherChanges) {
				findings[index] = base;

				return toolResult(
					clearing
						? `Review finding ${base.id} invalidReason cleared.`
						: `Review finding ${base.id} unchanged.`,
					base,
				);
			}

			const codeChange = resolveCodeChange(changes, base);

			const merged: Omit<ReviewFinding, "id"> = {
				title: changes.title ?? base.title,
				severity: changes.severity ?? base.severity,
				confidence: changes.confidence ?? base.confidence,
				problem: changes.problem ?? base.problem,
				suggestedChange: changes.suggestedChange ?? base.suggestedChange,
				relatedFiles: changes.relatedFiles ?? base.relatedFiles,
				rationale: changes.rationale ?? base.rationale,
				categories: resolveCategories(params as EditFindingParams, base),
				...codeChange,
			};

			const updated: ReviewFinding = {
				id,
				...(await validateFinding(merged, repoDir, findings, id)),
			};
			findings[index] = updated;

			return toolResult(
				`Review finding ${updated.id} updated. title="${updated.title}", severity=${updated.severity}.`,
				updated,
			);
		},
	});
};

export const createEditReviewFindingTool = (
	repoDir: string,
	findings: ReviewFinding[],
) => {
	return buildEditTool(
		repoDir,
		findings,
		Type.Object({
			id: idParam,
			invalidReason: invalidReasonParam,
			...Type.Partial(reviewFindingSchema).properties,
		}),
		editGuidelines,
		(_params, base) => base.categories,
	);
};

export const createGeneralistEditReviewFindingTool = (
	repoDir: string,
	findings: ReviewFinding[],
) => {
	return buildEditTool(
		repoDir,
		findings,
		Type.Object({
			id: idParam,
			invalidReason: invalidReasonParam,
			categories: categoriesParam,
			...Type.Partial(reviewFindingSchema).properties,
		}),
		[...editGuidelines],
		(params, base) => params.categories ?? base.categories,
	);
};
