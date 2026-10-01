import { Type } from "typebox";
import { defineTool } from "../../../engine/tools.js";
import type { Agent } from "../../../engine/types.js";
import type { ReviewFinding, ReviewScope } from "../types.js";
import {
	nextId,
	reviewFindingGuidelines,
	reviewFindingSchema,
	reviewScopeValues,
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
		description: "Submit one code review finding.",
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
				content: [
					{
						type: "text",
						text: `Review finding submitted. id=${finding.id}, title="${finding.title}", severity=${finding.severity}.`,
					},
				],
				details: finding,
			};
		},
	});
};

export const createGeneralistReviewFindingTool = (
	reviewer: Agent,
	repoDir: string,
	findings: ReviewFinding[],
) => {
	return defineTool({
		name: "submit_review_finding",
		label: "Submit Review Finding",
		description: "Submit one code review finding.",
		promptSnippet: "Submit structured review findings",
		promptGuidelines: [
			"Use submit_review_finding once for each distinct finding. Call it repeatedly for multiple findings.",
			"Set scope to every review scope the finding belongs to. Use more than one scope when the finding spans several scopes.",
			...reviewFindingGuidelines,
		],
		parameters: Type.Object({
			scope: Type.Array(Type.Enum(reviewScopeValues), {
				minItems: 1,
				description:
					"Every review scope the finding belongs to. Use more than one scope when the finding spans several scopes.",
			}),
			...reviewFindingSchema.properties,
		}),
		executionMode: "sequential",
		async execute(_toolCallId, params) {
			const { scope, ...findingParams } = params;
			const finding: ReviewFinding = {
				id: nextId(findings, reviewer.id),
				...(await validateFinding(findingParams, repoDir, findings)),
				scope: scope as ReviewScope[],
			};
			findings.push(finding);

			return {
				content: [
					{
						type: "text",
						text: `Review finding submitted. id=${finding.id}, title="${finding.title}", severity=${finding.severity}, scope=${finding.scope?.join(", ")}.`,
					},
				],
				details: finding,
			};
		},
	});
};
