import { defineTool } from "../../../engine/tools.js";
import type { Agent } from "../../../engine/types.js";
import type { ReviewFinding } from "../types.js";
import {
	nextId,
	reviewFindingGuidelines,
	reviewFindingSchema,
	validateFinding,
} from "./review-finding/index.js";

export const createReviewFindingTool = (
	reviewer: Agent,
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
			"Use submit_review_finding once for each distinct finding. Call it repeatedly for multiple findings.",
			...reviewFindingGuidelines,
		],
		parameters: reviewFindingSchema,
		executionMode: "sequential",
		async execute(_toolCallId, params) {
			const finding: ReviewFinding = {
				id: nextId(findings, reviewer.id),
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
