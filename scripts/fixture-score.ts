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
 * Corroboration units for a finding, mirroring the score phase. In single-agent
 * mode the finding carries a scope array, so the units are the scopes. Otherwise
 * the units are the contributing agents (mergedFrom when merged, else the
 * detecting agent).
 */
export const corroborationUnits = (
	agent: string,
	scope?: string[],
	mergedFrom?: string[],
): string[] => {
	if (scope && scope.length > 0) {
		return scope;
	}

	return mergedFrom && mergedFrom.length > 0 ? mergedFrom : [agent];
};

/**
 * Merge amplification factor for a finding, mirroring the score phase. It is the
 * number of distinct corroboration units, capped at MAX_MERGED_FACTOR.
 */
export const mergedFactor = (units: string[]): number =>
	Math.min(new Set(units).size, MAX_MERGED_FACTOR);

/**
 * Base score for a single finding, before any merge amplification. This is the
 * value a manifest purpose declares as its expected `score`. When the finding
 * carries a scope array (single-agent mode), the weight is the most severe
 * weight among the scopes; otherwise the weight comes from the agent id.
 */
export const baseScore = (
	severity: Severity,
	confidence: number,
	agent: string,
	scope?: string[],
): number =>
	round2(
		severityWeights[severity] *
			confidence *
			(scope && scope.length > 0
				? Math.max(
						...scope.map((item) => agentWeights[item] ?? DEFAULT_AGENT_WEIGHT),
					)
				: (agentWeights[agent] ?? DEFAULT_AGENT_WEIGHT)),
	);
