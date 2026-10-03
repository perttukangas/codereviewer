import { Type } from "typebox";
import { defineTool, toolResult } from "../../../engine/tools.js";
import { DeduplicatorAgent } from "../agents/deduplicator.js";
import { allFindings } from "../shared/findings.js";
import type { AgentReview, ReviewFinding, ReviewReport } from "../types.js";
import {
	codeChangeGuideline,
	mergeCodeChangeGuideline,
	nextId,
	relatedFilesGuideline,
	reviewFindingGuidelines,
	reviewFindingSchema,
	severityRank,
	validateFinding,
} from "./review-finding/index.js";

type FindingSource = {
	agentId: string;
	findings: ReviewFinding[];
	finding: ReviewFinding;
};

export const createMergeReviewFindingsTool = (
	repoDir: string,
	report: ReviewReport,
	dedupReview: AgentReview,
) => {
	const findSource = (id: string): FindingSource | undefined => {
		for (const [agentId, review] of Object.entries(report)) {
			const finding = review.findings.find(
				(finding) => finding.id === id && finding.invalidReason === undefined,
			);
			if (finding) {
				return { agentId, findings: review.findings, finding };
			}
		}

		const finding = dedupReview.findings.find(
			(finding) => finding.id === id && finding.invalidReason === undefined,
		);
		if (finding) {
			return {
				agentId: DeduplicatorAgent.id,
				findings: dedupReview.findings,
				finding,
			};
		}

		return undefined;
	};

	const findMergedInto = (id: string): ReviewFinding | undefined =>
		dedupReview.findings.find((finding) =>
			finding.mergedFindingIds?.includes(id),
		);

	const allFindingsInReport = (): ReviewFinding[] => [
		...allFindings(report),
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
			"Keep merged severity between the least and most severe source severity, and merged confidence between the lowest and highest source confidence.",
			"Do not provide relatedFiles. The merged finding inherits the union of the source findings' related files.",
			mergeCodeChangeGuideline,
			...reviewFindingGuidelines.filter(
				(guideline) =>
					guideline !== relatedFilesGuideline &&
					guideline !== codeChangeGuideline,
			),
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
			...Type.Omit(reviewFindingSchema, ["relatedFiles"]).properties,
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
				const alreadyMerged = findMergedInto(id);
				if (alreadyMerged) {
					throw new Error(
						`Finding ${id} was already merged into ${alreadyMerged.id}.`,
					);
				}
				const source = findSource(id);
				if (!source) {
					throw new Error(`Unknown review finding id: ${id}`);
				}
				return source;
			});

			const relatedFiles = [
				...new Set(
					sources.flatMap((source) => [
						...source.finding.relatedFiles,
						...(source.finding.codeChangeFilePath
							? [source.finding.codeChangeFilePath]
							: []),
					]),
				),
			];

			const scope = [
				...new Set(sources.flatMap((source) => source.finding.scope ?? [])),
			];

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

			const confidences = sources.map((source) => source.finding.confidence);
			const minConfidence = Math.min(...confidences);
			const maxConfidence = Math.max(...confidences);
			const corroborated =
				new Set(sources.map((source) => source.agentId)).size > 1;
			if (
				mergedFields.confidence < minConfidence ||
				(!corroborated && mergedFields.confidence > maxConfidence)
			) {
				throw new Error(
					corroborated
						? "Merged confidence must be at least the lowest confidence among the merged findings."
						: "Merged confidence must be between the lowest and highest confidence among the merged findings. Confidence may exceed the highest source only when the merged findings come from different agents.",
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

			const remaining = allFindingsInReport().filter(
				(finding) =>
					finding.invalidReason === undefined &&
					!uniqueIds.includes(finding.id),
			);

			const merged: ReviewFinding = {
				id: nextId(dedupReview.findings, DeduplicatorAgent.id),
				...(await validateFinding(
					{ ...mergedFields, relatedFiles },
					repoDir,
					remaining,
					undefined,
					sources.map((source) => source.finding),
				)),
				...(scope.length > 0 ? { scope } : {}),
				mergedFrom,
				mergedFindingIds,
			};

			for (const source of sources) {
				const index = source.findings.indexOf(source.finding);
				if (index !== -1) {
					source.findings.splice(index, 1);
				}
			}
			dedupReview.findings.push(merged);

			return toolResult(
				`Review findings merged into ${merged.id}. Merged ids: ${uniqueIds.join(", ")}. title="${merged.title}".`,
				merged,
			);
		},
	});
};
