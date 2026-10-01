import { createLogger } from "../../../shared/logger.js";
import type { Phase } from "../../pipeline.js";
import { logFindingsSnapshot } from "../shared/findings.js";
import type {
	ReviewFinding,
	ReviewPipelineState,
	ReviewSeverity,
} from "../types.js";

export const severityWeights: Record<ReviewSeverity, number> = {
	CRITICAL: 10,
	HIGH: 7,
	MEDIUM: 4,
	LOW: 2,
	INFO: 1,
};

export const agentWeights: Record<string, number> = {
	security: 1.5,
	correctness: 1.4,
	reliability: 1.2,
	performance: 1.0,
	maintainability: 0.8,
};

const DEFAULT_AGENT_WEIGHT = 1.0;
const MAX_MERGED_FACTOR = 3;

const round2 = (value: number): number => Math.round(value * 100) / 100;

const corroborationUnits = (
	finding: ReviewFinding,
	agentId: string,
): string[] => {
	const scopes = finding.scope;
	if (scopes && scopes.length > 0) {
		return scopes;
	}

	return finding.mergedFrom && finding.mergedFrom.length > 0
		? finding.mergedFrom
		: [agentId];
};

const mergedFactor = (units: string[]): number =>
	Math.min(new Set(units).size, MAX_MERGED_FACTOR);

const agentWeight = (units: string[]): number =>
	Math.max(...units.map((unit) => agentWeights[unit] ?? DEFAULT_AGENT_WEIGHT));

const scoreFinding = (finding: ReviewFinding, agentId: string): number => {
	const units = corroborationUnits(finding, agentId);

	return round2(
		severityWeights[finding.severity] *
			finding.confidence *
			mergedFactor(units) *
			agentWeight(units),
	);
};

export const score: Phase<ReviewPipelineState> = {
	id: "score",
	run: async (state) => {
		const { report } = state;
		const log = createLogger();

		for (const [agentId, review] of Object.entries(report)) {
			for (const finding of review.findings) {
				finding.score = scoreFinding(finding, agentId);
			}
		}

		logFindingsSnapshot(
			log,
			"Scored findings",
			Object.values(report).flatMap((review) => review.findings),
		);

		return state;
	},
};
