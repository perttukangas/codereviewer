import { defineTool } from "../../../engine/tools.js";
import type { ReviewFinding } from "../types.js";
import {
	nextFindingId,
	reviewFindingGuidelines,
	reviewFindingSchema,
	validateFinding,
} from "./review-finding.js";

export const createReviewFindingTool = (
	repoDir: string,
	findings: ReviewFinding[],
) => {
	return defineTool({
		name: "submit_review_finding",
		label: "Submit Review Finding",
		description:
			"Submit one evidence-based code review finding with precise file paths and specific fix guidance.",
		promptSnippet: "Submit structured review findings",
		promptGuidelines: [
			"Use submit_review_finding once for each distinct finding, and call it repeatedly for multiple findings.",
			"Scope findings to behavior affected by the diff. Report issues that are directly observable in the diff, or issues caused by the diff whose impact on other code can be confirmed through a read-only investigation. Do not report pre-existing issues, unrelated issues elsewhere in the codebase, speculative risks, or issues that require assumptions not supported by the diff or read-only evidence.",
			"If no findings are worth reporting, respond exactly: No reportable issues found.",
			...reviewFindingGuidelines,
			"After submitting all findings do not provide summary, respond exactly: Review complete.",
		],
		parameters: reviewFindingSchema,
		executionMode: "sequential",
		async execute(_toolCallId, params) {
			const finding: ReviewFinding = {
				id: nextFindingId(findings),
				...(await validateFinding(params, repoDir, findings)),
			};
			findings.push(finding);

			return {
				content: [{ type: "text", text: "Review finding submitted." }],
				details: finding,
			};
		},
	});
};
