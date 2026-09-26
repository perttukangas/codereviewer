import { Type } from "typebox";
import { defineTool } from "../../../engine/tools.js";
import type { ReviewFinding } from "../types.js";
import {
	type ReviewFindingInput,
	reviewFindingGuidelines,
	reviewFindingSchema,
	validateFinding,
} from "./review-finding/index.js";

type CodeChangeFields = Pick<
	ReviewFinding,
	"codeChangeFilePath" | "codeChangeOldText" | "codeChangeNewText"
>;

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

export const createEditReviewFindingTool = (
	repoDir: string,
	findings: ReviewFinding[],
) => {
	return defineTool({
		name: "edit_review_finding",
		label: "Edit Review Finding",
		description:
			"Edit an existing review finding that is factually wrong or unsupported, or mark it invalid when it cannot be corrected by editing.",
		promptSnippet:
			"Edit an existing review finding that is factually wrong or unsupported.",
		promptGuidelines: [
			"When using edit_review_finding provide only the fields that need correction. Omitted fields keep their current values.",
			"To edit code changes, provide codeChangeFilePath, codeChangeOldText, and codeChangeNewText together. To clear it, provide all three as empty strings.",
			"Mark a finding invalid with a non-empty invalidReason only when it cannot be corrected by editing. Do not combine invalidReason with field changes.",
			"A finding already marked invalid cannot be edited. Clear invalidReason with an empty string before editing its fields.",
			"Use the finding id from the findings under verification. Do not invent identifiers.",
			...reviewFindingGuidelines,
		],
		parameters: Type.Object({
			id: Type.String({
				description: "String identifier of the finding.",
			}),
			invalidReason: Type.Optional(
				Type.String({
					description:
						"Reason the finding is invalid and cannot be corrected by editing. Provide a non-empty reason to mark the finding invalid. Provide an empty string to clear an existing invalidReason. Do not combine with field changes.",
				}),
			),
			...Type.Partial(reviewFindingSchema).properties,
		}),
		executionMode: "sequential",
		async execute(_toolCallId, params) {
			const { id, invalidReason, ...changes } = params;
			const index = findings.findIndex((finding) => finding.id === id);
			if (index === -1) {
				throw new Error(`Unknown review finding id: ${id}`);
			}

			const existing = findings[index];
			const hasOtherChanges = Object.values(changes).some(
				(value) => value !== undefined,
			);
			const markingInvalid =
				invalidReason !== undefined && invalidReason.trim() !== "";
			const clearing =
				invalidReason !== undefined && invalidReason.trim() === "";

			if (markingInvalid && hasOtherChanges) {
				throw new Error(
					"Use either invalidReason or field changes, not both. If the finding can be corrected, edit it instead of marking it invalid.",
				);
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
					content: [{ type: "text", text: "Review finding marked invalid." }],
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
								? "Review finding invalidReason cleared."
								: "Review finding unchanged.",
						},
					],
					details: base,
				};
			}

			const codeChange = resolveCodeChange(changes, base);

			const merged: ReviewFindingInput = {
				title: changes.title ?? base.title,
				severity: changes.severity ?? base.severity,
				confidence: changes.confidence ?? base.confidence,
				problem: changes.problem ?? base.problem,
				suggestedChange: changes.suggestedChange ?? base.suggestedChange,
				relatedFiles: changes.relatedFiles ?? base.relatedFiles,
				rationale: changes.rationale ?? base.rationale,
				...codeChange,
			};

			const updated: ReviewFinding = {
				id,
				...(await validateFinding(merged, repoDir, findings, id)),
			};
			findings[index] = updated;

			return {
				content: [{ type: "text", text: "Review finding updated." }],
				details: updated,
			};
		},
	});
};
