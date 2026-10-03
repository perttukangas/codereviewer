import { type Static, type TSchema, Type } from "typebox";
import { defineTool, toolResult } from "../../../engine/tools.js";
import type { Agent } from "../../../engine/types.js";
import type { ReviewFinding, ReviewScope } from "../types.js";
import {
	nextId,
	requiredScopeParam,
	reviewFindingGuidelines,
	reviewFindingSchema,
	scopeGuideline,
	validateFinding,
} from "./review-finding/index.js";

type SubmitFindingParams = Static<typeof reviewFindingSchema> & {
	scope?: ReviewScope[];
};

const submitGuidelines = [
	"Use submit_review_finding once for each distinct finding. Call it repeatedly for multiple findings.",
];

const buildSubmitTool = (
	reviewer: Agent,
	repoDir: string,
	findings: ReviewFinding[],
	parameters: TSchema,
	guidelines: string[],
	withScope: boolean,
) => {
	return defineTool({
		name: "submit_review_finding",
		label: "Submit Review Finding",
		description: "Submit one code review finding.",
		promptSnippet: "Submit structured review findings",
		promptGuidelines: guidelines,
		parameters,
		executionMode: "sequential",
		async execute(_toolCallId, params) {
			const { scope, ...findingParams } = params as SubmitFindingParams;
			const finding: ReviewFinding = {
				id: nextId(findings, reviewer.id),
				...(await validateFinding(findingParams, repoDir, findings)),
				...(withScope ? { scope: scope as ReviewScope[] } : {}),
			};
			findings.push(finding);

			const scopeText = withScope ? `, scope=${finding.scope?.join(", ")}` : "";

			return toolResult(
				`Review finding submitted. id=${finding.id}, title="${finding.title}", severity=${finding.severity}${scopeText}.`,
				finding,
			);
		},
	});
};

export const createReviewFindingTool = (
	reviewer: Agent,
	repoDir: string,
	findings: ReviewFinding[],
) =>
	buildSubmitTool(
		reviewer,
		repoDir,
		findings,
		reviewFindingSchema,
		[...submitGuidelines, ...reviewFindingGuidelines],
		false,
	);

export const createGeneralistReviewFindingTool = (
	reviewer: Agent,
	repoDir: string,
	findings: ReviewFinding[],
) =>
	buildSubmitTool(
		reviewer,
		repoDir,
		findings,
		Type.Object({
			scope: requiredScopeParam,
			...reviewFindingSchema.properties,
		}),
		[...submitGuidelines, scopeGuideline, ...reviewFindingGuidelines],
		true,
	);
