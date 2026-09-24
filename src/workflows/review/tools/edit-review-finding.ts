import { Type } from "typebox";
import { defineTool } from "../../../engine/tools.js";
import type { ReviewFinding } from "../types.js";
import {
	type ReviewFindingInput,
	reviewFindingGuidelines,
	reviewFindingSchema,
	validateFinding,
} from "./review-finding.js";

// TODO ADD INVALID AND DESCRIPTION FIELD FOR EDIT WHEN IT CANT BE CORRECTED

export const createEditReviewFindingTool = (
	repoDir: string,
	findings: ReviewFinding[],
) => {
	return defineTool({
		name: "edit_review_finding",
		label: "Edit Review Finding",
		description:
			"Correct an existing review finding that is factually wrong or unsupported, keeping its identifier.",
		promptSnippet: "Correct an incorrect review finding",
		promptGuidelines: [
			"Critically evaluate each supplied finding rather than trusting the reviewer's claims. Independently confirm the evidence, challenge its assumptions, and re-derive the severity and confidence from the rubric yourself.",
			"Use edit_review_finding when your own analysis shows a finding is incorrect, unsupported by the diff or read-only evidence, misclassified in severity, has an inaccurate confidence, or has a wrong suggested fix. Do not edit a finding for wording, style, or other semantics that do not change its correctness.",
			...reviewFindingGuidelines,
			"Actively re-derive the correct severity from the rubric for every finding rather than accepting the submitted label. If the impact you identify meets a higher severity definition than the one submitted, raise the severity. A severe issue must not keep a lower label.",
			"Provide only the fields that need correction. Fields you omit keep their current values.",
			"To replace the suggested fix, provide suggestedCodeChanges or suggestedChange. Providing one clears the other. If you provide neither, the existing suggested fix is kept.",
			"Use the finding id from the findings under verification. Do not invent identifiers.",
			"After verifying all findings do not provide a summary, respond exactly: Verification complete.",
		],
		parameters: Type.Object({
			id: Type.Number({
				description: "Integer identifier of the finding to correct.",
			}),
			...Type.Partial(reviewFindingSchema).properties,
		}),
		executionMode: "sequential",
		async execute(_toolCallId, params) {
			const { id, ...changes } = params;
			const index = findings.findIndex((finding) => finding.id === id);
			if (index === -1) {
				throw new Error(`Unknown review finding id: ${id}`);
			}

			const existing = findings[index];
			const hasSuggestion =
				changes.suggestedChange !== undefined ||
				changes.suggestedCodeChanges !== undefined;

			const merged: ReviewFindingInput = {
				title: changes.title ?? existing.title,
				severity: changes.severity ?? existing.severity,
				confidence: changes.confidence ?? existing.confidence,
				problem: changes.problem ?? existing.problem,
				rationale: changes.rationale ?? existing.rationale,
				suggestedChange: hasSuggestion
					? changes.suggestedChange
					: existing.suggestedChange,
				suggestedCodeChanges: hasSuggestion
					? changes.suggestedCodeChanges
					: existing.suggestedCodeChanges,
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
