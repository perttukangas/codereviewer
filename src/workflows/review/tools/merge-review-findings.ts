import { Type } from "typebox";
import { defineTool } from "../../../engine/tools.js";
import { DeduplicatorAgent } from "../agents/deduplicator.js";
import type { AgentReview, ReviewFinding, ReviewReport } from "../types.js";
import {
	nextId,
	reviewFindingGuidelines,
	reviewFindingSchema,
	severityRank,
	validateFinding,
} from "./review-finding/index.js";

type FindingSource = {
	agentId: string;
	findings: ReviewFinding[];
	index: number;
	finding: ReviewFinding;
};

export const createMergeReviewFindingsTool = (
	repoDir: string,
	report: ReviewReport,
	dedupReview: AgentReview,
) => {
	const findSource = (id: string): FindingSource | undefined => {
		for (const [agentId, review] of Object.entries(report)) {
			const index = review.findings.findIndex(
				(finding) => finding.id === id && finding.invalidReason === undefined,
			);
			if (index !== -1) {
				return {
					agentId,
					findings: review.findings,
					index,
					finding: review.findings[index],
				};
			}
		}

		const index = dedupReview.findings.findIndex(
			(finding) => finding.id === id && finding.invalidReason === undefined,
		);
		if (index !== -1) {
			return {
				agentId: DeduplicatorAgent.id,
				findings: dedupReview.findings,
				index,
				finding: dedupReview.findings[index],
			};
		}

		return undefined;
	};

	const allFindings = (): ReviewFinding[] => [
		...Object.values(report).flatMap((review) => review.findings),
		...dedupReview.findings,
	];

	return defineTool({
		name: "merge_review_findings",
		label: "Merge Review Findings",
		description:
			"Merge two or more duplicate review findings into a single consolidated finding and remove the originals.",
		promptSnippet: "Merge duplicate review findings into one",
		promptGuidelines: [
			"Use merge_review_findings once for each group of findings that describe the same underlying issue.",
			"Provide the ids of every finding in the group. At least two distinct ids are required.",
			...reviewFindingGuidelines,
		],
		parameters: Type.Object({
			findingIds: Type.Array(
				Type.String({
					minLength: 1,
					description: "String identifier of a finding to merge.",
				}),
				{
					minItems: 2,
					description:
						"Two or more distinct finding ids that describe the same issue.",
				},
			),
			...reviewFindingSchema.properties,
		}),
		executionMode: "sequential",
		async execute(_toolCallId, params) {
			const { findingIds, ...mergedFields } = params;
			const uniqueIds = [...new Set(findingIds)];
			if (uniqueIds.length < 2) {
				throw new Error(
					"merge_review_findings requires at least two distinct finding ids.",
				);
			}

			const sources = uniqueIds.map((id) => {
				const source = findSource(id);
				if (!source) {
					throw new Error(`Unknown review finding id: ${id}`);
				}
				return source;
			});

			const severities = sources.map((source) =>
				severityRank(source.finding.severity),
			);
			const mergedSeverity = severityRank(mergedFields.severity);
			if (
				mergedSeverity < Math.min(...severities) ||
				mergedSeverity > Math.max(...severities)
			) {
				throw new Error(
					"Merged severity must be between the least and most severe severity among the merged findings.",
				);
			}

			const minConfidence = Math.min(
				...sources.map((source) => source.finding.confidence),
			);
			if (mergedFields.confidence < minConfidence) {
				throw new Error(
					`Merged confidence must be at least ${minConfidence}, the lowest confidence among the merged findings.`,
				);
			}

			const mergedFrom = [
				...new Set(
					sources.flatMap(
						(source) => source.finding.mergedFrom ?? [source.agentId],
					),
				),
			];
			const mergedFindingIds = [
				...new Set(
					sources.flatMap(
						(source) => source.finding.mergedFindingIds ?? [source.finding.id],
					),
				),
			];

			const remaining = allFindings().filter(
				(finding) => !uniqueIds.includes(finding.id),
			);

			const merged: ReviewFinding = {
				id: nextId(dedupReview.findings, DeduplicatorAgent.id),
				...(await validateFinding(mergedFields, repoDir, remaining)),
				mergedFrom,
				mergedFindingIds,
			};

			for (const source of sources) {
				source.findings.splice(source.index, 1);
			}
			dedupReview.findings.push(merged);

			return {
				content: [{ type: "text", text: "Review findings merged." }],
				details: merged,
			};
		},
	});
};
