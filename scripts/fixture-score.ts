export type Severity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO";

// These tables mirror src/workflows/review/phases/score.ts. They are duplicated
// here on purpose: that module transitively imports the env and logger modules,
// which require environment variables at load time and would break the fixture
// scripts. Keep the values in sync with score.ts.
export const severityWeights: Record<Severity, number> = {
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

export const round2 = (value: number): number => Math.round(value * 100) / 100;

/**
 * Merge amplification factor for a finding, mirroring the score phase. It is the
 * number of distinct agents that contributed to the finding, capped at
 * MAX_MERGED_FACTOR.
 */
export const mergedFactor = (agents: string[]): number =>
	Math.min(new Set(agents).size, MAX_MERGED_FACTOR);

/**
 * Base score for a single finding, before any merge amplification. This is the
 * value a manifest purpose declares as its expected `score`.
 */
export const baseScore = (
	severity: Severity,
	confidence: number,
	agent: string,
): number =>
	round2(
		severityWeights[severity] *
			confidence *
			(agentWeights[agent] ?? DEFAULT_AGENT_WEIGHT),
	);
