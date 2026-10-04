import type { ReviewFinding, ReviewReport } from "../types.js";

export const severityValues = [
	"CRITICAL",
	"HIGH",
	"MEDIUM",
	"LOW",
	"INFO",
] as const;

export type ReviewSeverity = (typeof severityValues)[number];

export const severityRank = (severity: ReviewSeverity): number =>
	severityValues.indexOf(severity);

export const severityWeights: Record<ReviewSeverity, number> = {
	CRITICAL: 10,
	HIGH: 7,
	MEDIUM: 4,
	LOW: 2,
	INFO: 1,
};

export const confidenceValues = [
	"DEMONSTRATED",
	"STRONG",
	"PLAUSIBLE",
	"SPECULATIVE",
] as const;

export type ReviewConfidence = (typeof confidenceValues)[number];

export const confidenceRank = (confidence: ReviewConfidence): number =>
	confidenceValues.indexOf(confidence);

export const confidenceWeights: Record<ReviewConfidence, number> = {
	DEMONSTRATED: 1.0,
	STRONG: 0.8,
	PLAUSIBLE: 0.5,
	SPECULATIVE: 0.2,
};

export const agentWeights: Record<string, number> = {
	SECURITY: 1.5,
	CORRECTNESS: 1.4,
	RELIABILITY: 1.2,
	PERFORMANCE: 1.0,
	MAINTAINABILITY: 0.8,
};

const DEFAULT_AGENT_WEIGHT = 1.0;
const MAX_MERGED_FACTOR = 3;

export const round2 = (value: number): number => Math.round(value * 100) / 100;

export const corroborationUnits = (
	agentId: string,
	categories?: string[],
	mergedFrom?: string[],
): string[] => {
	if (categories && categories.length > 0) {
		return categories;
	}

	return mergedFrom && mergedFrom.length > 0 ? mergedFrom : [agentId];
};

export const mergedFactor = (units: string[]): number =>
	Math.min(new Set(units).size, MAX_MERGED_FACTOR);

const agentWeight = (units: string[]): number =>
	Math.max(...units.map((unit) => agentWeights[unit] ?? DEFAULT_AGENT_WEIGHT));

export const baseScore = (
	severity: ReviewSeverity,
	confidence: ReviewConfidence,
	agent: string,
	categories?: string[],
): number =>
	round2(
		severityWeights[severity] *
			confidenceWeights[confidence] *
			(categories && categories.length > 0
				? Math.max(
						...categories.map(
							(item) => agentWeights[item] ?? DEFAULT_AGENT_WEIGHT,
						),
					)
				: (agentWeights[agent] ?? DEFAULT_AGENT_WEIGHT)),
	);

export const scoreFinding = (
	finding: ReviewFinding,
	agentId: string,
): number => {
	const units = corroborationUnits(
		agentId,
		finding.categories,
		finding.mergedFrom,
	);

	return round2(
		severityWeights[finding.severity] *
			confidenceWeights[finding.confidence] *
			mergedFactor(units) *
			agentWeight(units),
	);
};

export const scoreFindings = (report: ReviewReport): void => {
	for (const [agentId, review] of Object.entries(report)) {
		for (const finding of review.findings) {
			finding.score = scoreFinding(finding, agentId);
		}
	}
};
