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

const contributingAgents = (
	finding: ReviewFinding,
	agentId: string,
): string[] =>
	finding.mergedFrom && finding.mergedFrom.length > 0
		? finding.mergedFrom
		: [agentId];

const mergedFactor = (agents: string[]): number =>
	Math.min(new Set(agents).size, MAX_MERGED_FACTOR);

const agentWeight = (agents: string[]): number =>
	Math.max(
		...agents.map((agent) => agentWeights[agent] ?? DEFAULT_AGENT_WEIGHT),
	);

const scoreFinding = (finding: ReviewFinding, agentId: string): number => {
	const agents = contributingAgents(finding, agentId);

	return round2(
		severityWeights[finding.severity] *
			finding.confidence *
			mergedFactor(agents) *
			agentWeight(agents),
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
