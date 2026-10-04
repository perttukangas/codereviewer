import { type Static, type TSchema, Type } from "typebox";
import { defineTool, toolResult } from "../../../engine/tools.js";
import type { Agent } from "../../../engine/types.js";
import type { ReviewCategory, ReviewFinding } from "../types.js";
import {
	nextId,
	prepareFindingArguments,
	requiredCategoriesParam,
	reviewFindingGuidelines,
	reviewFindingSchema,
	validateFinding,
} from "./review-finding/index.js";

type SubmitFindingParams = Static<typeof reviewFindingSchema> & {
	categories?: ReviewCategory[];
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
	withCategories: boolean,
) => {
	return defineTool({
		name: "submit_review_finding",
		label: "Submit Review Finding",
		description: "Submit one code review finding.",
		promptSnippet: "Submit structured review findings",
		promptGuidelines: guidelines,
		parameters,
		prepareArguments: prepareFindingArguments,
		executionMode: "sequential",
		async execute(_toolCallId, params) {
			const { categories, ...findingParams } = params as SubmitFindingParams;
			const finding: ReviewFinding = {
				id: nextId(findings, reviewer.id),
				...(await validateFinding(findingParams, repoDir, findings)),
				...(withCategories
					? { categories: categories as ReviewCategory[] }
					: {}),
			};
			findings.push(finding);

			const categoriesText = withCategories
				? `, categories=${finding.categories?.join(", ")}`
				: "";

			return toolResult(
				`Review finding submitted. id=${finding.id}, title="${finding.title}", severity=${finding.severity}${categoriesText}.`,
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
			categories: requiredCategoriesParam,
			...reviewFindingSchema.properties,
		}),
		[...submitGuidelines, ...reviewFindingGuidelines],
		true,
	);
