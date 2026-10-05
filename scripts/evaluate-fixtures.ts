import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentTelemetry } from "../src/engine/types.ts";
import type { AgentUsage } from "../src/runtime/types.ts";
import {
	baseScore,
	confidenceRank,
	confidenceValues,
	corroborationUnits,
	mergedFactor,
	type ReviewConfidence,
	type ReviewSeverity,
	round2,
	severityRank,
	severityValues,
} from "../src/workflows/review/shared/scoring.ts";
import type {
	ReviewFinding,
	ReviewReport,
} from "../src/workflows/review/types.ts";
import type { WorkflowResult } from "../src/workflows/types.ts";

type Tier = "tier1" | "tier2" | "tier3";

type Mode = "multi" | "single";

const modes: Mode[] = ["multi", "single"];

type Purpose = {
	id: string;
	mainAgent: string;
	severity: ReviewSeverity;
	confidence: ReviewConfidence;
	score: number;
	title?: string;
	expectedFiles?: string[];
	expectedLines?: [number, number];
};

type Manifest = {
	id: string;
	repository: string;
	revision: string;
	difficulty: Tier;
	diff: {
		path: string;
		changedFiles: string[];
		purposes: Purpose[];
	};
};

type MatchValue = string | string[] | null;

type Matches = Record<string, MatchValue>;

const projectDir = join(import.meta.dirname, "..");
const diffsRoot = join(projectDir, "test", "fixtures", "diffs");
const resultsRoot = join(projectDir, "test", "fixtures", "results");

const readJson = async <T>(path: string): Promise<T | undefined> => {
	try {
		return JSON.parse(await readFile(path, "utf8")) as T;
	} catch {
		return undefined;
	}
};

const findManifests = async (): Promise<{ manifest: Manifest; dir: string }[]> => {
	const found: { manifest: Manifest; dir: string }[] = [];

	for (const tier of ["tier1", "tier2", "tier3"] as const) {
		const tierDir = join(diffsRoot, tier);
		const entries = await readdir(tierDir, { withFileTypes: true }).catch(
			() => [],
		);

		for (const entry of entries) {
			if (!entry.isDirectory() || !entry.name.startsWith("T")) {
				continue;
			}
			const dir = join(tierDir, entry.name);
			const manifest = await readJson<Manifest>(join(dir, "manifest.json"));
			if (manifest) {
				found.push({ manifest, dir });
			}
		}
	}

	return found.sort((a, b) => a.manifest.id.localeCompare(b.manifest.id));
};

type DiffSize = {
	id: string;
	tier: Tier;
	bytes: number;
	lines: number;
	changedFiles: number;
};

const findDiffSizes = async (
	manifests: { manifest: Manifest; dir: string }[],
): Promise<DiffSize[]> => {
	const sizes: DiffSize[] = [];

	for (const { manifest, dir } of manifests) {
		try {
			const content = await readFile(join(dir, "review.diff"), "utf8");
			sizes.push({
				id: manifest.id,
				tier: manifest.difficulty,
				bytes: Buffer.byteLength(content, "utf8"),
				lines: content.split("\n").length,
				changedFiles: manifest.diff.changedFiles.length,
			});
		} catch {
			// No diff for this test.
		}
	}

	return sizes;
};

type ModelInfo = {
	parameters?: number;
	activeParameters?: number;
};

const modelsPath = join(projectDir, "test", "fixtures", "models.json");

const loadModelInfo = async (): Promise<Record<string, ModelInfo>> =>
	(await readJson<Record<string, ModelInfo>>(modelsPath)) ?? {};

const toIdList = (value: MatchValue): string[] => {
	if (value === null || value === undefined) {
		return [];
	}
	return Array.isArray(value) ? value : [value];
};

const findFinding = (
	report: ReviewReport,
	id: string,
): { agentId: string; finding: ReviewFinding } | undefined => {
	for (const [agentId, review] of Object.entries(report)) {
		const finding = review.findings.find((item) => item.id === id);
		if (finding) {
			return { agentId, finding };
		}
	}

	// The deduplicator splices merged sources out of their agent arrays and
	// stores the merged finding under its own key. Follow the merge so a match
	// that references a source id still resolves.
	for (const [agentId, review] of Object.entries(report)) {
		const finding = review.findings.find((item) =>
			item.mergedFindingIds?.includes(id),
		);
		if (finding) {
			return { agentId, finding };
		}
	}

	return undefined;
};

type PurposeResult = {
	purposeId: string;
	mainAgent: string;
	detected: boolean;
	mainTargetDetected: boolean;
	detectingAgents: string[];
	corroborationUnits: number;
	expectedSeverity: ReviewSeverity;
	reportedSeverity?: ReviewSeverity;
	expectedConfidence: ReviewConfidence;
	reportedConfidence?: ReviewConfidence;
	severityError?: number;
	confidenceError?: number;
	baseScoreError?: number;
	scoreError?: number;
};

type ModeResult = {
	mode: Mode;
	purposes: PurposeResult[];
	additionalFindings: number;
	invalidFindings: number;
	validFindings: number;
	actionableFindings: number;
	merges: number;
	mergedSources: number;
	findingsBeforeDedup: number;
	overlappingFindings: number;
	overlappingPairs: number;
	missingMatches: boolean;
	telemetry?: {
		durationMs: number;
		usage: AgentUsage;
		agents: Record<string, AgentTelemetry>;
	};
};

type TestResult = {
	id: string;
	tier: Tier;
	modes: ModeResult[];
};

const evaluateMode = (
	manifest: Manifest,
	mode: Mode,
	result: WorkflowResult<ReviewReport>,
	matches: Matches | undefined,
): ModeResult => {
	const report = result.output;

	const purposes: PurposeResult[] = manifest.diff.purposes.map((purpose) => {
		const matchedIds = toIdList(matches?.[purpose.id] ?? null);
		const resolved = matchedIds
			.map((id) => findFinding(report, id))
			.filter((item): item is { agentId: string; finding: ReviewFinding } =>
				Boolean(item),
			);

		const detectingAgents = [
			...new Set(
				resolved.flatMap((item) => item.finding.mergedFrom ?? [item.agentId]),
			),
		];
		const mainTargetDetected =
			mode === "single"
				? resolved.some((item) =>
						(item.finding.categories ?? []).some(
							(category) => category === purpose.mainAgent,
						),
					)
				: detectingAgents.includes(purpose.mainAgent);
		const primaryEntry = resolved[0];
		const primary = primaryEntry?.finding;
		const primaryUnits = primaryEntry
			? corroborationUnits(
					primaryEntry.agentId,
					primaryEntry.finding.categories,
					primaryEntry.finding.mergedFrom,
				)
			: [];
		// Corroboration units are the distinct agents that reported the finding in
		// multi mode, or the distinct categories the generalist assigned in single
		// mode. This mirrors the units that drive the scoring merged factor.
		const corroborationUnitSet = new Set(
			resolved.flatMap((item) =>
				corroborationUnits(
					item.agentId,
					item.finding.categories,
					item.finding.mergedFrom,
				),
			),
		);

		return {
			purposeId: purpose.id,
			mainAgent: purpose.mainAgent,
			detected: resolved.length > 0,
			mainTargetDetected,
			detectingAgents,
			corroborationUnits: corroborationUnitSet.size,
			expectedSeverity: purpose.severity,
			reportedSeverity: primary?.severity,
			expectedConfidence: purpose.confidence,
			reportedConfidence: primary?.confidence,
			severityError: primary
				? Math.abs(
						severityRank(purpose.severity) - severityRank(primary.severity),
					)
				: undefined,
			confidenceError: primary
				? Math.abs(
						confidenceRank(purpose.confidence) -
							confidenceRank(primary.confidence),
					)
				: undefined,
			baseScoreError: primary
				? round2(
						Math.abs(
							purpose.score -
								baseScore(
									primary.severity,
									primary.confidence,
									purpose.mainAgent,
									primary.categories,
								),
						),
					)
				: undefined,
			scoreError:
				primary?.score !== undefined
					? round2(
							Math.abs(
								purpose.score * mergedFactor(primaryUnits) - primary.score,
							),
						)
					: undefined,
		};
	});

	const matchedFindingIds = new Set(
		manifest.diff.purposes.flatMap((purpose) =>
			toIdList(matches?.[purpose.id] ?? null).flatMap((id) => {
				const resolved = findFinding(report, id);
				return resolved
					? [
							id,
							resolved.finding.id,
							...(resolved.finding.mergedFindingIds ?? []),
						]
					: [id];
			}),
		),
	);
	const allFindings = Object.values(report).flatMap(
		(review) => review.findings,
	);
	const validFindings = allFindings.filter(
		(finding) => finding.invalidReason === undefined,
	);
	const additionalFindings = validFindings.filter(
		(finding) => !matchedFindingIds.has(finding.id),
	).length;
	const invalidFindings = allFindings.filter(
		(finding) => finding.invalidReason !== undefined,
	).length;
	const actionableFindings = validFindings.filter(
		(finding) => finding.codeChangeFilePath !== undefined,
	).length;

	const mergedFindings = allFindings.filter(
		(finding) => (finding.mergedFrom?.length ?? 0) > 0,
	);
	const mergedSourceIds = new Set(
		mergedFindings.flatMap((finding) => finding.mergedFindingIds ?? []),
	);
	const merges = mergedFindings.length;
	const mergedSources = mergedSourceIds.size;
	const findingsBeforeDedup = allFindings.length + mergedSources - merges;

	const overlappingFindings = allFindings.filter(
		(finding) => (finding.codeChangesOverlap?.length ?? 0) > 0,
	).length;
	const overlappingPairs = new Set(
		allFindings.flatMap((finding) =>
			(finding.codeChangesOverlap ?? []).map((other) =>
				[finding.id, other].sort().join("|"),
			),
		),
	).size;

	return {
		mode,
		purposes,
		additionalFindings,
		invalidFindings,
		validFindings: validFindings.length,
		actionableFindings,
		merges,
		mergedSources,
		findingsBeforeDedup,
		overlappingFindings,
		overlappingPairs,
		missingMatches: matches === undefined,
		telemetry: result.telemetry
			? {
					durationMs: result.telemetry.durationMs,
					usage: result.telemetry.usage,
					agents: result.telemetry.agents,
				}
			: undefined,
	};
};

type RunResult = {
	model: string;
	modelSlug: string;
	runIndex: number;
	tests: TestResult[];
};

type ModelResult = {
	model: string;
	modelSlug: string;
	runs: RunResult[];
};

type ModelDir = {
	model: string;
	modelSlug: string;
	runIndexes: number[];
};

const findModelDirs = async (): Promise<ModelDir[]> => {
	const entries = await readdir(resultsRoot, { withFileTypes: true }).catch(
		() => [],
	);
	const found: ModelDir[] = [];

	for (const entry of entries) {
		if (!entry.isDirectory()) {
			continue;
		}
		const modelDir = join(resultsRoot, entry.name);
		const runEntries = await readdir(modelDir, { withFileTypes: true }).catch(
			() => [],
		);
		const runIndexes = runEntries
			.filter((run) => run.isDirectory() && /^run-\d+$/.test(run.name))
			.map((run) => Number(run.name.slice("run-".length)))
			.sort((a, b) => a - b);

		if (runIndexes.length === 0) {
			continue;
		}

		const runJson = await readJson<{ model?: string }>(
			join(modelDir, `run-${runIndexes[0]}`, "run.json"),
		);
		found.push({
			model: runJson?.model ?? entry.name,
			modelSlug: entry.name,
			runIndexes,
		});
	}

	return found.sort((a, b) => a.model.localeCompare(b.model));
};

const evaluateRun = async (
	model: string,
	modelSlug: string,
	runIndex: number,
	manifests: { manifest: Manifest; dir: string }[],
): Promise<RunResult> => {
	const tests: TestResult[] = [];

	for (const { manifest } of manifests) {
		const modeResults: ModeResult[] = [];
		const testDir = join(resultsRoot, modelSlug, `run-${runIndex}`, manifest.id);

		for (const mode of modes) {
			const reportPath = join(testDir, `report.${mode}.json`);
			const matchesPath = join(testDir, `matches.${mode}.json`);

			const result = await readJson<WorkflowResult<ReviewReport>>(reportPath);
			if (!result) {
				continue;
			}

			const matches = await readJson<Matches>(matchesPath);
			modeResults.push(evaluateMode(manifest, mode, result, matches));
		}

		if (modeResults.length > 0) {
			tests.push({
				id: manifest.id,
				tier: manifest.difficulty,
				modes: modeResults,
			});
		}
	}

	return { model, modelSlug, runIndex, tests };
};

type RunMetrics = {
	tests: number;
	recall: number;
	mainTargetRecall: number;
	additionalFindings: number;
	invalidFindings: number;
	validFindings: number;
	actionabilityRate: number;
	merges: number;
	mergedSources: number;
	dedupReductionRate: number;
	overlappingFindings: number;
	overlappingPairs: number;
	corroboratedFindings: number;
	severityError: number;
	confidenceError: number;
	baseScoreError: number;
	scoreError: number;
	durationMs: number;
	totalTokens: number;
};

const average = (values: number[]): number =>
	values.length === 0
		? 0
		: values.reduce((sum, value) => sum + value, 0) / values.length;

const runMetrics = (tests: TestResult[], mode: Mode): RunMetrics | undefined => {
	const modeResults = tests.flatMap((test) =>
		test.modes.filter((item) => item.mode === mode),
	);
	if (modeResults.length === 0) {
		return undefined;
	}

	const purposes = modeResults.flatMap((item) => item.purposes);
	const durations = defined(
		modeResults.map((item) => item.telemetry?.durationMs),
	);
	const tokens = defined(
		modeResults.map((item) => item.telemetry?.usage.totalTokens),
	);
	const validFindings = modeResults.reduce(
		(sum, item) => sum + item.validFindings,
		0,
	);
	const actionableFindings = modeResults.reduce(
		(sum, item) => sum + item.actionableFindings,
		0,
	);
	const merges = modeResults.reduce((sum, item) => sum + item.merges, 0);
	const mergedSources = modeResults.reduce(
		(sum, item) => sum + item.mergedSources,
		0,
	);
	const findingsBeforeDedup = modeResults.reduce(
		(sum, item) => sum + item.findingsBeforeDedup,
		0,
	);
	const detected = purposes.filter((purpose) => purpose.detected);
	const corroborated = detected.filter(
		(purpose) => purpose.corroborationUnits > 1,
	);

	return {
		tests: modeResults.length,
		recall:
			purposes.length === 0
				? 0
				: detected.length / purposes.length,
		mainTargetRecall:
			purposes.length === 0
				? 0
				: purposes.filter((purpose) => purpose.mainTargetDetected).length /
					purposes.length,
		additionalFindings: modeResults.reduce(
			(sum, item) => sum + item.additionalFindings,
			0,
		),
		invalidFindings: modeResults.reduce(
			(sum, item) => sum + item.invalidFindings,
			0,
		),
		validFindings,
		actionabilityRate:
			validFindings === 0 ? 0 : actionableFindings / validFindings,
		merges,
		mergedSources,
		dedupReductionRate:
			findingsBeforeDedup === 0
				? 0
				: (mergedSources - merges) / findingsBeforeDedup,
		overlappingFindings: modeResults.reduce(
			(sum, item) => sum + item.overlappingFindings,
			0,
		),
		overlappingPairs: modeResults.reduce(
			(sum, item) => sum + item.overlappingPairs,
			0,
		),
		corroboratedFindings: corroborated.length,
		severityError: average(
			defined(purposes.map((purpose) => purpose.severityError)),
		),
		confidenceError: average(
			defined(purposes.map((purpose) => purpose.confidenceError)),
		),
		baseScoreError: average(
			defined(purposes.map((purpose) => purpose.baseScoreError)),
		),
		scoreError: average(
			defined(purposes.map((purpose) => purpose.scoreError)),
		),
		durationMs: average(durations),
		totalTokens: average(tokens),
	};
};

type Stats = {
	mean: number;
	stddev: number;
	min: number;
	max: number;
	n: number;
};

const stats = (values: number[]): Stats | undefined => {
	if (values.length === 0) {
		return undefined;
	}
	const mean = average(values);
	const variance = average(values.map((value) => (value - mean) ** 2));
	return {
		mean,
		stddev: Math.sqrt(variance),
		min: Math.min(...values),
		max: Math.max(...values),
		n: values.length,
	};
};

type MetricKind = "ratio" | "number";

type MetricDef = {
	key: keyof RunMetrics;
	label: string;
	kind: MetricKind;
};

const metricDefs: MetricDef[] = [
	{ key: "recall", label: "Recall", kind: "ratio" },
	{ key: "mainTargetRecall", label: "Main-target recall", kind: "ratio" },
	{ key: "corroboratedFindings", label: "Corroborated findings", kind: "number" },
	{ key: "actionabilityRate", label: "Actionability rate", kind: "ratio" },
	{ key: "dedupReductionRate", label: "Dedup reduction rate", kind: "ratio" },
	{ key: "additionalFindings", label: "Additional findings", kind: "number" },
	{ key: "invalidFindings", label: "Invalid findings", kind: "number" },
	{ key: "validFindings", label: "Valid findings", kind: "number" },
	{ key: "merges", label: "Merges", kind: "number" },
	{ key: "mergedSources", label: "Merged sources", kind: "number" },
	{ key: "overlappingFindings", label: "Overlapping findings", kind: "number" },
	{ key: "overlappingPairs", label: "Overlapping pairs", kind: "number" },
	{ key: "severityError", label: "Mean severity error", kind: "number" },
	{ key: "confidenceError", label: "Mean confidence error", kind: "number" },
	{ key: "baseScoreError", label: "Mean base score error", kind: "number" },
	{ key: "scoreError", label: "Mean score error", kind: "number" },
	{ key: "durationMs", label: "Mean duration (ms)", kind: "number" },
	{ key: "totalTokens", label: "Mean total tokens", kind: "number" },
];

const formatValue = (value: number, kind: MetricKind): string =>
	kind === "ratio" ? `${(value * 100).toFixed(1)}%` : value.toFixed(2);

const formatStats = (value: Stats | undefined, kind: MetricKind): string =>
	value === undefined
		? "n/a"
		: `${formatValue(value.mean, kind)} ± ${formatValue(value.stddev, kind)}`;

const modelMetricStats = (
	model: ModelResult,
	mode: Mode,
): Map<keyof RunMetrics, Stats> => {
	const perRun = model.runs
		.map((run) => runMetrics(run.tests, mode))
		.filter((metrics): metrics is RunMetrics => metrics !== undefined);

	const result = new Map<keyof RunMetrics, Stats>();
	for (const def of metricDefs) {
		const value = stats(perRun.map((metrics) => metrics[def.key]));
		if (value) {
			result.set(def.key, value);
		}
	}
	return result;
};

const modelTests = (model: ModelResult): TestResult[] =>
	model.runs.flatMap((run) => run.tests);

const modelRunsForMode = (model: ModelResult, mode: Mode): number =>
	model.runs.filter((run) =>
		run.tests.some((test) => test.modes.some((item) => item.mode === mode)),
	).length;

// Computes a ratio per run (detected over selected purposes) and returns the
// mean and standard deviation across runs, so breakdowns show run-to-run
// variation instead of a single pooled ratio.
const perRunRatioStats = (
	model: ModelResult,
	mode: Mode,
	select: (test: TestResult, purpose: PurposeResult) => boolean,
	numerator: (purpose: PurposeResult) => boolean,
): Stats | undefined => {
	const perRun = model.runs
		.map((run) => {
			const purposes = run.tests.flatMap((test) =>
				test.modes
					.filter((item) => item.mode === mode)
					.flatMap((item) => item.purposes)
					.filter((purpose) => select(test, purpose)),
			);
			if (purposes.length === 0) {
				return undefined;
			}
			return purposes.filter(numerator).length / purposes.length;
		})
		.filter((value): value is number => value !== undefined);
	return stats(perRun);
};

type ConfusionMatrix<T extends string> = {
	values: readonly T[];
	counts: number[][];
	rowTotals: number[];
};

const confusionMatrix = <T extends string>(
	values: readonly T[],
	pairs: { expected: T; reported: T }[],
): ConfusionMatrix<T> => {
	const counts = values.map(() => values.map(() => 0));
	const rowTotals = values.map(() => 0);

	for (const pair of pairs) {
		const row = values.indexOf(pair.expected);
		const column = values.indexOf(pair.reported);
		if (row >= 0 && column >= 0) {
			counts[row][column] += 1;
			rowTotals[row] += 1;
		}
	}

	return { values, counts, rowTotals };
};

const severityPairs = (purposes: PurposeResult[]) =>
	purposes
		.filter(
			(purpose): purpose is PurposeResult & { reportedSeverity: ReviewSeverity } =>
				purpose.reportedSeverity !== undefined,
		)
		.map((purpose) => ({
			expected: purpose.expectedSeverity,
			reported: purpose.reportedSeverity,
		}));

const confidencePairs = (purposes: PurposeResult[]) =>
	purposes
		.filter(
			(
				purpose,
			): purpose is PurposeResult & {
				reportedConfidence: ReviewConfidence;
			} => purpose.reportedConfidence !== undefined,
		)
		.map((purpose) => ({
			expected: purpose.expectedConfidence,
			reported: purpose.reportedConfidence,
		}));

type PairOutcome = { win: number; tie: number; loss: number };

const pairedOutcomes = (model: ModelResult): PairOutcome => {
	const outcome: PairOutcome = { win: 0, tie: 0, loss: 0 };

	for (const run of model.runs) {
		for (const test of run.tests) {
			const multi = test.modes.find((item) => item.mode === "multi");
			const single = test.modes.find((item) => item.mode === "single");
			if (!multi || !single) {
				continue;
			}
			const multiDetected = multi.purposes.filter(
				(purpose) => purpose.detected,
			).length;
			const singleDetected = single.purposes.filter(
				(purpose) => purpose.detected,
			).length;
			if (multiDetected > singleDetected) {
				outcome.win += 1;
			} else if (multiDetected === singleDetected) {
				outcome.tie += 1;
			} else {
				outcome.loss += 1;
			}
		}
	}

	return outcome;
};

type Efficiency = {
	tokensPerFinding?: Stats;
	durationPerFinding?: Stats;
};

const modelModeEfficiency = (
	model: ModelResult,
	mode: Mode,
): Efficiency => {
	const perRun = model.runs.map((run) => {
		const modeResults = run.tests.flatMap((test) =>
			test.modes.filter((item) => item.mode === mode),
		);
		const detected = modeResults
			.flatMap((item) => item.purposes)
			.filter((purpose) => purpose.detected).length;
		const tokens = defined(
			modeResults.map((item) => item.telemetry?.usage.totalTokens),
		);
		const durations = defined(
			modeResults.map((item) => item.telemetry?.durationMs),
		);
		const totalTokens = tokens.reduce((sum, value) => sum + value, 0);
		const totalDuration = durations.reduce((sum, value) => sum + value, 0);

		return {
			tokensPerFinding: detected === 0 ? undefined : totalTokens / detected,
			durationPerFinding:
				detected === 0 ? undefined : totalDuration / detected,
		};
	});

	return {
		tokensPerFinding: stats(
			defined(perRun.map((run) => run.tokensPerFinding)),
		),
		durationPerFinding: stats(
			defined(perRun.map((run) => run.durationPerFinding)),
		),
	};
};

const renderConfusion = <T extends string>(
	matrix: ConfusionMatrix<T>,
	rowLabel: string,
): string[] => {
	const lines: string[] = [];
	lines.push(
		`| ${rowLabel} (expected, manifest) \\ Reported (model) | ${matrix.values.join(" | ")} | Total |`,
	);
	lines.push(
		`| --- | ${matrix.values.map(() => "---").join(" | ")} | --- |`,
	);
	matrix.values.forEach((value, row) => {
		const cells = matrix.counts[row].map((count) => String(count));
		lines.push(
			`| ${value} | ${cells.join(" | ")} | ${matrix.rowTotals[row]} |`,
		);
	});
	lines.push("");
	return lines;
};

const modeResults = (results: TestResult[], mode: Mode): ModeResult[] =>
	results.flatMap((result) =>
		result.modes.filter((item) => item.mode === mode),
	);

const modePurposes = (results: TestResult[], mode: Mode): PurposeResult[] =>
	modeResults(results, mode).flatMap((result) => result.purposes);

const defined = (values: (number | undefined)[]): number[] =>
	values.filter((value): value is number => value !== undefined);

const totalContinuations = (modeResult: ModeResult | undefined): number =>
	Object.values(modeResult?.telemetry?.agents ?? {}).reduce(
		(sum, agent) => sum + agent.continuations,
		0,
	);

type AgentContinuation = {
	mode: Mode;
	model: string;
	continuations: number;
};

const agentContinuations = (results: TestResult[]): AgentContinuation[] =>
	results.flatMap((result) =>
		result.modes.flatMap((modeResult) =>
			Object.entries(modeResult.telemetry?.agents ?? {}).map(
				([, agent]) => ({
					mode: modeResult.mode,
					model: agent.model,
					continuations: agent.continuations,
				}),
			),
		),
	);

const buildSummary = (
	models: ModelResult[],
	heading: string,
	diffSizes: DiffSize[],
	modelInfo: Record<string, ModelInfo>,
): string => {
	const lines: string[] = [];
	lines.push(`# ${heading}`);
	lines.push("");

	lines.push("## Averages across runs");
	lines.push("");
	lines.push(
		"Per model and mode, the mean and standard deviation across runs. Recall is " +
			"detected purposes over declared purposes. Main-target recall counts a purpose " +
			"only when its declared main agent detected it. Corroborated findings count " +
			"detected purposes supported by more than one corroboration unit, which is a " +
			"distinct agent in multi mode or a distinct category in single mode. " +
			"Actionability rate is the " +
			"share of valid findings with a concrete code change. Dedup reduction rate is " +
			"the share of findings the deduplicator collapsed. Additional findings are valid " +
			"findings not matched to a declared purpose, which is extra coverage rather than " +
			"noise. Invalid findings were marked invalid by the verifier. Valid findings " +
			"exclude invalid ones. Merges and merged sources count deduplicator merges and " +
			"the source findings they absorbed. Overlapping findings and pairs count findings " +
			"whose code changes touch a shared line range, which is not the same as being " +
			"duplicates. Severity, confidence, base score, and score " +
			"errors are mean absolute differences from the manifest. Duration and tokens " +
			"are per-test totals.",
	);
	lines.push("");

	lines.push(
		`| Model | Mode | Runs | ${metricDefs.map((def) => def.label).join(" | ")} |`,
	);
	lines.push(
		`| ----- | ---- | ---- | ${metricDefs.map(() => "---").join(" | ")} |`,
	);
	for (const model of models) {
		for (const mode of modes) {
			const statsByMetric = modelMetricStats(model, mode);
			if (statsByMetric.size === 0) {
				continue;
			}
			const cells = metricDefs.map((def) =>
				formatStats(statsByMetric.get(def.key), def.kind),
			);
			lines.push(
				`| ${model.model} | ${mode} | ${modelRunsForMode(model, mode)} | ${cells.join(" | ")} |`,
			);
		}
	}
	lines.push("");

	lines.push("## Cross-model comparison");
	lines.push("");
	lines.push(
		"One row per model and mode, joining model size to quality and efficiency. " +
			"Total params is the model's full parameter count and active params is the " +
			"per-token compute, which differ for mixture-of-experts models. The remaining " +
			"columns are the same quality metrics as above, plus tokens and duration per " +
			"detected finding so a larger model is not credited for quality that comes only " +
			"from spending more.",
	);
	lines.push("");
	lines.push(
		"| Model | Total params (B) | Active params (B) | Mode | Recall | Main-target recall | Actionability rate | Dedup reduction rate | Severity error | Tokens/finding | Duration/finding (ms) |",
	);
	lines.push(
		"| ----- | ---------------- | ----------------- | ---- | ------ | ------------------ | ------------------ | -------------------- | -------------- | -------------- | --------------------- |",
	);
	for (const model of models) {
		const info = modelInfo[model.model];
		for (const mode of modes) {
			const statsByMetric = modelMetricStats(model, mode);
			if (statsByMetric.size === 0) {
				continue;
			}
			const efficiency = modelModeEfficiency(model, mode);
			lines.push(
				`| ${model.model} | ${info?.parameters ?? "n/a"} | ${info?.activeParameters ?? "n/a"} | ${mode} | ${formatStats(statsByMetric.get("recall"), "ratio")} | ${formatStats(statsByMetric.get("mainTargetRecall"), "ratio")} | ${formatStats(statsByMetric.get("actionabilityRate"), "ratio")} | ${formatStats(statsByMetric.get("dedupReductionRate"), "ratio")} | ${formatStats(statsByMetric.get("severityError"), "number")} | ${formatStats(efficiency.tokensPerFinding, "number")} | ${formatStats(efficiency.durationPerFinding, "number")} |`,
			);
		}
	}
	lines.push("");

	lines.push("## Recall by tier");
	lines.push("");
	lines.push(
		"Recall and main-target recall split by fixture difficulty tier, as the mean " +
			"and standard deviation across runs. Tier 1 issues are visible in one part of " +
			"the diff, tier 2 need the surrounding file, and tier 3 need reasoning across files.",
	);
	lines.push("");
	lines.push("| Model | Mode | Tier | Recall | Main-target recall |");
	lines.push("| ----- | ---- | ---- | ------ | ------------------ |");
	for (const model of models) {
		for (const mode of modes) {
			for (const tier of ["tier1", "tier2", "tier3"] as const) {
				const recall = perRunRatioStats(
					model,
					mode,
					(test) => test.tier === tier,
					(purpose) => purpose.detected,
				);
				if (recall === undefined) {
					continue;
				}
				const mainTarget = perRunRatioStats(
					model,
					mode,
					(test) => test.tier === tier,
					(purpose) => purpose.mainTargetDetected,
				);
				lines.push(
					`| ${model.model} | ${mode} | ${tier} | ${formatStats(recall, "ratio")} | ${formatStats(mainTarget, "ratio")} |`,
				);
			}
		}
	}
	lines.push("");

	lines.push("## Recall by main agent");
	lines.push("");
	lines.push(
		"Recall and main-target recall split by the agent declared as each purpose's " +
			"main target, as the mean and standard deviation across runs. Main-target " +
			"recall counts a purpose only when that agent detected it.",
	);
	lines.push("");
	lines.push("| Model | Mode | Agent | Recall | Main-target recall |");
	lines.push("| ----- | ---- | ----- | ------ | ------------------ |");
	for (const model of models) {
		for (const mode of modes) {
			const purposes = modePurposes(modelTests(model), mode);
			const agents = [
				...new Set(purposes.map((purpose) => purpose.mainAgent)),
			].sort();
			for (const agent of agents) {
				const recall = perRunRatioStats(
					model,
					mode,
					(_test, purpose) => purpose.mainAgent === agent,
					(purpose) => purpose.detected,
				);
				const mainTarget = perRunRatioStats(
					model,
					mode,
					(_test, purpose) => purpose.mainAgent === agent,
					(purpose) => purpose.mainTargetDetected,
				);
				lines.push(
					`| ${model.model} | ${mode} | ${agent} | ${formatStats(recall, "ratio")} | ${formatStats(mainTarget, "ratio")} |`,
				);
			}
		}
	}
	lines.push("");

	lines.push("## Severity confusion (expected vs reported)");
	lines.push("");
	lines.push(
		"For each detected purpose, the manifest's expected severity (rows) against the " +
			"reported severity (columns), pooled across runs. A diagonal-heavy matrix means " +
			"the model rates severity consistently with the manifest, and off-diagonal cells " +
			"show the direction of any bias.",
	);
	lines.push("");
	for (const model of models) {
		for (const mode of modes) {
			const purposes = modePurposes(modelTests(model), mode);
			const pairs = severityPairs(purposes);
			if (pairs.length === 0) {
				continue;
			}
			lines.push(`### ${model.model} (${mode})`);
			lines.push("");
			lines.push(
				...renderConfusion(
					confusionMatrix(severityValues, pairs),
					"Severity",
				),
			);
		}
	}

	lines.push("## Confidence confusion (expected vs reported)");
	lines.push("");
	lines.push(
		"For each detected purpose, the manifest's expected confidence (rows) against " +
			"the reported confidence (columns), pooled across runs. A diagonal-heavy matrix " +
			"means the model rates confidence consistently with the manifest.",
	);
	lines.push("");
	for (const model of models) {
		for (const mode of modes) {
			const purposes = modePurposes(modelTests(model), mode);
			const pairs = confidencePairs(purposes);
			if (pairs.length === 0) {
				continue;
			}
			lines.push(`### ${model.model} (${mode})`);
			lines.push("");
			lines.push(
				...renderConfusion(
					confusionMatrix(confidenceValues, pairs),
					"Confidence",
				),
			);
		}
	}

	lines.push("## Per test");
	lines.push("");
	lines.push(
		"Recall, additional findings, and invalid findings for each test, run, and mode, " +
			"so individual tests can be inspected.",
	);
	lines.push("");
	lines.push(
		"| Model | Run | Test | Tier | Mode | Recall | Additional findings | Invalid findings |",
	);
	lines.push(
		"| ----- | --- | ---- | ---- | ---- | ------ | ------------------- | ---------------- |",
	);
	for (const model of models) {
		for (const run of model.runs) {
			for (const result of run.tests) {
				for (const modeResult of result.modes) {
					const detected = modeResult.purposes.filter(
						(purpose) => purpose.detected,
					).length;
					const total = modeResult.purposes.length;
					const recall =
						total === 0
							? "n/a"
							: `${detected}/${total} (${((detected / total) * 100).toFixed(1)}%)`;
					lines.push(
						`| ${model.model} | ${run.runIndex} | ${result.id} | ${result.tier} | ${modeResult.mode} | ${recall} | ${modeResult.additionalFindings} | ${modeResult.invalidFindings} |`,
					);
				}
			}
		}
	}
	lines.push("");

	lines.push("## Deduplication and overlap per test");
	lines.push("");
	lines.push(
		"Deduplication and overlap for each test, run, and mode. Merges is the number of " +
			"merged findings, merged sources is the number of source findings they absorbed, " +
			"and findings before dedup is the count before merging. Dedup reduction rate is " +
			"the share collapsed. Overlapping findings and pairs count findings whose code " +
			"changes touch a shared line range. Overlap does not mean the findings are " +
			"duplicates, only that their suggested edits cover some of the same lines, so it " +
			"is a separate signal from the deduplicator's merges.",
	);
	lines.push("");
	lines.push(
		"| Model | Run | Test | Mode | Merges | Merged sources | Findings before dedup | Dedup reduction rate | Overlapping findings | Overlapping pairs |",
	);
	lines.push(
		"| ----- | --- | ---- | ---- | ------ | -------------- | --------------------- | -------------------- | -------------------- | ----------------- |",
	);
	for (const model of models) {
		for (const run of model.runs) {
			for (const result of run.tests) {
				for (const modeResult of result.modes) {
					const reduction =
						modeResult.findingsBeforeDedup === 0
							? "n/a"
							: `${(
									((modeResult.mergedSources - modeResult.merges) /
										modeResult.findingsBeforeDedup) *
									100
								).toFixed(1)}%`;
					lines.push(
						`| ${model.model} | ${run.runIndex} | ${result.id} | ${modeResult.mode} | ${modeResult.merges} | ${modeResult.mergedSources} | ${modeResult.findingsBeforeDedup} | ${reduction} | ${modeResult.overlappingFindings} | ${modeResult.overlappingPairs} |`,
					);
				}
			}
		}
	}
	lines.push("");

	lines.push("## Multi vs single (paired per test)");
	lines.push("");
	lines.push(
		"For each test, whether multi mode detected more (win), the same (tie), or fewer " +
			"(loss) purposes than single mode, pooled across runs. Win rate is wins over " +
			"decided pairs. Corroborated counts detected purposes supported by more than one " +
			"corroboration unit, which is a distinct agent in multi mode or a distinct " +
			"category in single mode.",
	);
	lines.push("");
	lines.push(
		"| Model | Wins | Ties | Losses | Win rate (decided) | Corroborated (multi) | Corroborated (single) |",
	);
	lines.push(
		"| ----- | ---- | ---- | ------ | ------------------ | -------------------- | --------------------- |",
	);
	for (const model of models) {
		const outcome = pairedOutcomes(model);
		const decided = outcome.win + outcome.loss;
		const winRate =
			decided === 0 ? "n/a" : `${((outcome.win / decided) * 100).toFixed(1)}%`;
		const multi = modelMetricStats(model, "multi").get("corroboratedFindings");
		const single = modelMetricStats(model, "single").get(
			"corroboratedFindings",
		);
		lines.push(
			`| ${model.model} | ${outcome.win} | ${outcome.tie} | ${outcome.loss} | ${winRate} | ${formatStats(multi, "number")} | ${formatStats(single, "number")} |`,
		);
	}
	lines.push("");

	lines.push("## Telemetry (multi vs single)");
	lines.push("");
	lines.push(
		"Duration, tokens, and completion continuations for each test, run, and mode, " +
			"comparing multi and single side by side.",
	);
	lines.push("");
	lines.push(
		"| Model | Run | Test | Multi duration (ms) | Single duration (ms) | Multi tokens | Single tokens | Multi continuations | Single continuations |",
	);
	lines.push(
		"| ----- | --- | ---- | ------------------- | -------------------- | ------------ | ------------- | ------------------- | -------------------- |",
	);
	for (const model of models) {
		for (const run of model.runs) {
			for (const result of run.tests) {
				const multi = result.modes.find((item) => item.mode === "multi");
				const single = result.modes.find((item) => item.mode === "single");
				lines.push(
					`| ${model.model} | ${run.runIndex} | ${result.id} | ${multi?.telemetry?.durationMs ?? "n/a"} | ${single?.telemetry?.durationMs ?? "n/a"} | ${multi?.telemetry?.usage.totalTokens ?? "n/a"} | ${single?.telemetry?.usage.totalTokens ?? "n/a"} | ${totalContinuations(multi)} | ${totalContinuations(single)} |`,
				);
			}
		}
	}
	lines.push("");

	lines.push("## Completion continuations by model");
	lines.push("");
	lines.push(
		"Completion continuations per agent model and mode, pooled across runs. Runs is " +
			"the number of agent runs, total continuations is how many times the completion " +
			"tool was re-prompted, and runs with continuations is how many runs needed at " +
			"least one.",
	);
	lines.push("");
	lines.push(
		"| Model | Mode | Agent model | Runs | Total continuations | Runs with continuations |",
	);
	lines.push(
		"| ----- | ---- | ----------- | ---- | ------------------- | ----------------------- |",
	);
	for (const model of models) {
		for (const mode of modes) {
			const entries = agentContinuations(modelTests(model)).filter(
				(entry) => entry.mode === mode,
			);
			const agentModels = [
				...new Set(entries.map((entry) => entry.model)),
			].sort();
			for (const agentModel of agentModels) {
				const modelEntries = entries.filter(
					(entry) => entry.model === agentModel,
				);
				const total = modelEntries.reduce(
					(sum, entry) => sum + entry.continuations,
					0,
				);
				const withContinuations = modelEntries.filter(
					(entry) => entry.continuations > 0,
				).length;
				lines.push(
					`| ${model.model} | ${mode} | ${agentModel} | ${modelEntries.length} | ${total} | ${withContinuations} |`,
				);
			}
		}
	}
	lines.push("");

	const missing = models.flatMap((model) =>
		model.runs.flatMap((run) =>
			run.tests.flatMap((result) =>
				result.modes
					.filter((modeResult) => modeResult.missingMatches)
					.map(
						(modeResult) =>
							`${model.model} run-${run.runIndex} ${result.id} (${modeResult.mode})`,
					),
			),
		),
	);
	if (missing.length > 0) {
		lines.push("## Missing matches.json");
		lines.push("");
		lines.push(
			`The following test modes have no matches file and were counted as undetected: ${missing.join(", ")}`,
		);
		lines.push("");
	}

	lines.push("## Diff sizes");
	lines.push("");
	lines.push(
		"The size of each fixture diff. Diff size is bytes, diff lines is the line count, " +
			"and changed files is the number of files the diff touches.",
	);
	lines.push("");
	lines.push("| Test | Tier | Diff size (bytes) | Diff lines | Changed files |");
	lines.push("| ---- | ---- | ----------------- | ---------- | ------------- |");
	for (const size of diffSizes) {
		lines.push(
			`| ${size.id} | ${size.tier} | ${size.bytes} | ${size.lines} | ${size.changedFiles} |`,
		);
	}
	lines.push("");

	return lines.join("\n");
};

const main = async (): Promise<void> => {
	const manifests = await findManifests();
	const diffSizes = await findDiffSizes(manifests);
	const modelInfo = await loadModelInfo();
	const modelDirs = await findModelDirs();
	const models: ModelResult[] = [];

	for (const modelDir of modelDirs) {
		const runs: RunResult[] = [];
		for (const runIndex of modelDir.runIndexes) {
			const run = await evaluateRun(
				modelDir.model,
				modelDir.modelSlug,
				runIndex,
				manifests,
			);
			if (run.tests.length > 0) {
				runs.push(run);
			}
		}
		if (runs.length > 0) {
			models.push({
				model: modelDir.model,
				modelSlug: modelDir.modelSlug,
				runs,
			});
		}
	}

	if (models.length === 0) {
		console.warn("No evaluated tests. Run fixtures:run-all first.");
		return;
	}

	const combined = buildSummary(
		models,
		"Fixture evaluation summary",
		diffSizes,
		modelInfo,
	);
	await writeFile(join(resultsRoot, "summary.md"), combined, "utf8");
	await writeFile(
		join(resultsRoot, "summary.json"),
		JSON.stringify({ models, diffSizes, modelInfo }, null, 2),
		"utf8",
	);

	for (const model of models) {
		const perModel = buildSummary(
			[model],
			`Fixture evaluation summary: ${model.model}`,
			diffSizes,
			modelInfo,
		);
		await writeFile(
			join(resultsRoot, model.modelSlug, "summary.md"),
			perModel,
			"utf8",
		);
	}

	console.log(combined);
};

await main();
