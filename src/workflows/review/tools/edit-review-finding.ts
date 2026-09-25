import { Type } from "typebox";
import { defineTool } from "../../../engine/tools.js";
import type { ReviewFinding } from "../types.js";
import {
	type ReviewFindingInput,
	reviewFindingGuidelines,
	reviewFindingSchema,
	validateFinding,
} from "./review-finding/index.js";

export const createEditReviewFindingTool = (
	repoDir: string,
	findings: ReviewFinding[],
) => {
	return defineTool({
		name: "edit_review_finding",
		label: "Edit Review Finding",
		description:
			"Correct an existing review finding that is factually wrong or unsupported, or mark it invalid when it cannot be corrected by editing.",
		promptSnippet:
			"If required correct or invalidate an incorrect review finding",
		promptGuidelines: [
			"Critically evaluate each supplied finding rather than trusting the reviewer's claims. Independently confirm the evidence, challenge its assumptions, and re-derive the severity and confidence from the rubric yourself.",
			"Use edit_review_finding when your own analysis shows a finding is incorrect, unsupported by the diff or read-only evidence, misclassified in severity, has an inaccurate confidence, or has a wrong suggested fix. Do not edit a finding for wording, style, or other semantics that do not change its correctness.",
			...reviewFindingGuidelines,
			"Actively re-derive the correct severity from the rubric for every finding rather than accepting the submitted label. If the impact you identify meets a higher severity definition than the one submitted, raise the severity. A severe issue must not keep a lower label.",
			"Provide only the fields that need correction. Fields you omit keep their current values.",
			"To replace the suggested fix, provide suggestedCodeChanges or suggestedChange. Providing one clears the other. If you provide neither, the existing suggested fix is kept.",
			"Mark a finding invalid with a clear invalidReason ONLY when it cannot be corrected by editing, never for wording or style. Do not combine invalidReason with field changes.",
			"A finding already marked invalid cannot be edited. Clear invalidReason with an empty string before editing its fields.",
			"Use the finding id from the findings under verification. Do not invent identifiers.",
			"After verifying all findings do not provide a summary, respond exactly: Verification complete.",
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

			const hasSuggestion =
				changes.suggestedChange !== undefined ||
				changes.suggestedCodeChanges !== undefined;

			const merged: ReviewFindingInput = {
				title: changes.title ?? base.title,
				severity: changes.severity ?? base.severity,
				confidence: changes.confidence ?? base.confidence,
				problem: changes.problem ?? base.problem,
				rationale: changes.rationale ?? base.rationale,
				suggestedChange: hasSuggestion
					? changes.suggestedChange
					: base.suggestedChange,
				suggestedCodeChanges: hasSuggestion
					? changes.suggestedCodeChanges
					: base.suggestedCodeChanges,
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
