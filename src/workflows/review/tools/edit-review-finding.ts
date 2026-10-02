import { type Static, type TSchema, Type } from "typebox";
import { defineTool } from "../../../engine/tools.js";
import type { ReviewFinding, ReviewScope } from "../types.js";
import {
	reviewFindingGuidelines,
	reviewFindingSchema,
	reviewScopeValues,
	validateFinding,
} from "./review-finding/index.js";

type CodeChangeFields = Pick<
	ReviewFinding,
	"codeChangeFilePath" | "codeChangeOldText" | "codeChangeNewText"
>;

type EditFindingParams = Partial<Static<typeof reviewFindingSchema>> & {
	id: string;
	invalidReason?: string;
	scope?: ReviewScope[];
};

const resolveCodeChange = (
	changes: Partial<CodeChangeFields>,
	base: ReviewFinding,
): Partial<CodeChangeFields> => {
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
	"Mark a finding invalid by providing a non-empty invalidReason. Do not combine invalidReason with field changes.",
	"A finding already marked invalid cannot be edited. Clear invalidReason with an empty string before editing its fields.",
	"Use the finding id from the findings under verification. Do not invent identifiers.",
	...reviewFindingGuidelines,
];

const scopeGuideline =
	"Set scope to every review scope the finding belongs to. Use more than one scope when the finding spans several scopes.";

const idParam = Type.String({
	description: "String identifier of the finding.",
});

const invalidReasonParam = Type.Optional(
	Type.String({
		description:
			"Reason the finding is invalid. Provide a non-empty reason to mark the finding invalid. Provide an empty string to clear an existing invalidReason. Do not combine with field changes.",
	}),
);

const scopeParam = Type.Optional(
	Type.Array(Type.Enum(reviewScopeValues), {
		minItems: 1,
		description:
			"Every review scope the finding belongs to. Use more than one scope when the finding spans several scopes.",
	}),
);

const buildEditTool = (
	repoDir: string,
	findings: ReviewFinding[],
	parameters: TSchema,
	guidelines: string[],
	resolveScope: (
		params: EditFindingParams,
		base: ReviewFinding,
	) => ReviewScope[] | undefined,
) => {
	return defineTool({
		name: "edit_review_finding",
		label: "Edit Review Finding",
		description: "Edit an existing review finding by id, or mark it invalid.",
		promptSnippet: "Edit an existing review finding by id",
		promptGuidelines: guidelines,
		parameters,
		executionMode: "sequential",
		async execute(_toolCallId, params) {
			const { id, invalidReason, scope, ...changes } =
				params as EditFindingParams;
			const index = findings.findIndex((finding) => finding.id === id);
			if (index === -1) {
				throw new Error(`Unknown review finding id: ${id}`);
			}

			const existing = findings[index];
			const hasOtherChanges =
				scope !== undefined ||
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

				return {
					content: [
						{
							type: "text",
							text: `Review finding ${updated.id} marked invalid.`,
						},
					],
					details: updated,
				};
			}

			const base: ReviewFinding = { ...existing };
			if (clearing) {
				delete base.invalidReason;
			}

			if (!hasOtherChanges) {
				findings[index] = base;

				return {
					content: [
						{
							type: "text",
							text: clearing
								? `Review finding ${base.id} invalidReason cleared.`
								: `Review finding ${base.id} unchanged.`,
						},
					],
					details: base,
				};
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
				scope: resolveScope(params as EditFindingParams, base),
				...codeChange,
			};

			const updated: ReviewFinding = {
				id,
				...(await validateFinding(merged, repoDir, findings, id)),
			};
			findings[index] = updated;

			return {
				content: [
					{
						type: "text",
						text: `Review finding ${updated.id} updated. title="${updated.title}", severity=${updated.severity}.`,
					},
				],
				details: updated,
			};
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
		(_params, base) => base.scope,
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
			scope: scopeParam,
			...Type.Partial(reviewFindingSchema).properties,
		}),
		[...editGuidelines, scopeGuideline],
		(params, base) => params.scope ?? base.scope,
	);
};
