import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentTelemetry, WorkflowError } from "../src/engine/types.ts";
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
	mr: string;
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

type TestSpec = {
	id: string;
	tier: Tier;
	mr: string;
	bytes: number;
	lines: number;
	changedFiles: number;
};

const findTestSpecs = async (
	manifests: { manifest: Manifest; dir: string }[],
): Promise<TestSpec[]> => {
	const specs: TestSpec[] = [];

	for (const { manifest, dir } of manifests) {
		try {
			const content = await readFile(join(dir, "review.diff"), "utf8");
			specs.push({
				id: manifest.id,
				tier: manifest.difficulty,
				mr: manifest.mr,
				bytes: Buffer.byteLength(content, "utf8"),
				lines: content.split("\n").length,
				changedFiles: manifest.diff.changedFiles.length,
			});
		} catch {
			// No diff for this test.
		}
	}

	return specs;
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
	// True when the purpose is matched to more than one distinct finding, which
	// means the deduplicator failed to merge findings describing the same issue.
	unmergedDuplicate: boolean;
	// The distinct reported finding ids the purpose resolved to.
	matchedFindingIds: string[];
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
	unmergedDuplicates: number;
	overlappingFindings: number;
	overlappingPairs: number;
	missingMatches: boolean;
	errors: WorkflowError[];
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

		// Pick the single finding that represents the purpose. Prefer one whose
		// corroboration units include the declared main agent, so a match to several
		// findings does not inflate the corroboration count. Fall back to the first
		// resolved finding.
		const primaryEntry =
			resolved.find((item) =>
				corroborationUnits(
					item.agentId,
					item.finding.categories,
					item.finding.mergedFrom,
				).includes(purpose.mainAgent),
			) ?? resolved[0];
		const primary = primaryEntry?.finding;
		// Corroboration units come from the single primary finding only. A match to
		// several findings describing the same issue is a deduplicator miss, not
		// extra corroboration, so it must not raise the merged factor.
		const primaryUnits = primaryEntry
			? corroborationUnits(
					primaryEntry.agentId,
					primaryEntry.finding.categories,
					primaryEntry.finding.mergedFrom,
				)
			: [];
		const detectingAgents = [
			...new Set(
				primaryEntry
					? (primaryEntry.finding.mergedFrom ?? [primaryEntry.agentId])
					: [],
			),
		];
		const mainTargetDetected =
			mode === "single"
				? (primary?.categories ?? []).some(
						(category) => category === purpose.mainAgent,
					)
				: detectingAgents.includes(purpose.mainAgent);
		// Distinct resolved findings. A match to several source ids that all resolve
		// to one merged finding collapses to a single id here, so it is not counted
		// as an unmerged duplicate.
		const resolvedFindingIds = new Set(
			resolved.map((item) => item.finding.id),
		);

		return {
			purposeId: purpose.id,
			mainAgent: purpose.mainAgent,
			detected: resolved.length > 0,
			mainTargetDetected,
			detectingAgents,
			corroborationUnits: new Set(primaryUnits).size,
			unmergedDuplicate: resolvedFindingIds.size > 1,
			matchedFindingIds: [...resolvedFindingIds],
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
									primaryEntry?.agentId ?? purpose.mainAgent,
									primaryUnits,
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
		unmergedDuplicates: purposes.filter((purpose) => purpose.unmergedDuplicate)
			.length,
		overlappingFindings,
		overlappingPairs,
		missingMatches: matches === undefined,
		errors: result.errors,
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
	unmergedDuplicates: number;
	errors: number;
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
		unmergedDuplicates: modeResults.reduce(
			(sum, item) => sum + item.unmergedDuplicates,
			0,
		),
		errors: modeResults.reduce((sum, item) => sum + item.errors.length, 0),
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
	const variance =
		values.length === 1
			? 0
			: values.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
				(values.length - 1);
	return {
		mean,
		stddev: Math.sqrt(variance),
		min: Math.min(...values),
		max: Math.max(...values),
		n: values.length,
	};
};

type MetricKind = "ratio" | "number" | "duration" | "tokens";

// Which findings a metric is computed from. "purpose" means only findings
// matched to a declared manifest purpose, "findings" means every finding in the
// report, and "run" means the metric is not finding-scoped at all.
type MetricScope = "purpose" | "findings" | "run";

type MetricDef = {
	key: keyof RunMetrics;
	label: string;
	kind: MetricKind;
	scope: MetricScope;
};

const metricDefs: MetricDef[] = [
	{ key: "recall", label: "Recall", kind: "ratio", scope: "purpose" },
	{
		key: "mainTargetRecall",
		label: "Main-target recall",
		kind: "ratio",
		scope: "purpose",
	},
	{
		key: "corroboratedFindings",
		label: "Corroborated findings",
		kind: "number",
		scope: "purpose",
	},
	{
		key: "unmergedDuplicates",
		label: "Unmerged duplicates",
		kind: "number",
		scope: "purpose",
	},
	{ key: "errors", label: "Mean errors", kind: "number", scope: "run" },
	{
		key: "actionabilityRate",
		label: "Actionability rate",
		kind: "ratio",
		scope: "findings",
	},
	{
		key: "dedupReductionRate",
		label: "Dedup reduction rate",
		kind: "ratio",
		scope: "findings",
	},
	{
		key: "additionalFindings",
		label: "Additional findings",
		kind: "number",
		scope: "findings",
	},
	{
		key: "invalidFindings",
		label: "Invalid findings",
		kind: "number",
		scope: "findings",
	},
	{
		key: "validFindings",
		label: "Valid findings",
		kind: "number",
		scope: "findings",
	},
	{ key: "merges", label: "Merges", kind: "number", scope: "findings" },
	{
		key: "mergedSources",
		label: "Merged sources",
		kind: "number",
		scope: "findings",
	},
	{
		key: "overlappingFindings",
		label: "Overlapping findings",
		kind: "number",
		scope: "findings",
	},
	{
		key: "overlappingPairs",
		label: "Overlapping pairs",
		kind: "number",
		scope: "findings",
	},
	{
		key: "severityError",
		label: "Mean severity error",
		kind: "number",
		scope: "purpose",
	},
	{
		key: "confidenceError",
		label: "Mean confidence error",
		kind: "number",
		scope: "purpose",
	},
	{
		key: "baseScoreError",
		label: "Mean base score error",
		kind: "number",
		scope: "purpose",
	},
	{ key: "scoreError", label: "Mean score error", kind: "number", scope: "purpose" },
	{
		key: "durationMs",
		label: "Mean duration (min)",
		kind: "duration",
		scope: "run",
	},
	{
		key: "totalTokens",
		label: "Mean total tokens (K)",
		kind: "tokens",
		scope: "run",
	},
];

// Purpose-scoped metrics are marked so a reader can tell at a glance which
// columns are computed only from findings matched to a declared purpose.
const PURPOSE_MARKER = "*";

const metricLabel = (def: MetricDef): string =>
	def.scope === "purpose" ? `${def.label} ${PURPOSE_MARKER}` : def.label;

const formatValue = (value: number, kind: MetricKind): string => {
	if (kind === "ratio") {
		return `${(value * 100).toFixed(1)}%`;
	}
	if (kind === "duration") {
		return (value / 60000).toFixed(2);
	}
	if (kind === "tokens") {
		return (value / 1000).toFixed(2);
	}
	return value.toFixed(2);
};

const formatDuration = (value: number | undefined): string =>
	value === undefined ? "n/a" : (value / 60000).toFixed(2);

const formatTokens = (value: number | undefined): string =>
	value === undefined ? "n/a" : (value / 1000).toFixed(2);

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
// mean and sample standard deviation across runs, so breakdowns show run-to-run
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
		// Efficiency is measured against every valid finding in the report, not only
		// findings matched to a declared purpose, so a model is not credited for
		// spending less by reporting fewer findings. Invalid findings are excluded.
		const findings = modeResults.reduce(
			(sum, item) => sum + item.validFindings,
			0,
		);
		const tokens = defined(
			modeResults.map((item) => item.telemetry?.usage.totalTokens),
		);
		const durations = defined(
			modeResults.map((item) => item.telemetry?.durationMs),
		);
		const totalTokens = tokens.reduce((sum, value) => sum + value, 0);
		const totalDuration = durations.reduce((sum, value) => sum + value, 0);

		return {
			tokensPerFinding: findings === 0 ? undefined : totalTokens / findings,
			durationPerFinding:
				findings === 0 ? undefined : totalDuration / findings,
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

type UsageTotals = {
	tests: number;
	durationMs: number;
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
	totalTokens: number;
	reportedTotalTokens: number;
	toolCalls: number;
};

const emptyUsageTotals = (): UsageTotals => ({
	tests: 0,
	durationMs: 0,
	inputTokens: 0,
	outputTokens: 0,
	cacheReadTokens: 0,
	cacheWriteTokens: 0,
	totalTokens: 0,
	reportedTotalTokens: 0,
	toolCalls: 0,
});

const addUsageTotals = (totals: UsageTotals, modeResult: ModeResult): void => {
	const telemetry = modeResult.telemetry;
	if (!telemetry) {
		return;
	}
	totals.tests += 1;
	totals.durationMs += telemetry.durationMs;
	totals.inputTokens += telemetry.usage.inputTokens;
	totals.outputTokens += telemetry.usage.outputTokens;
	totals.cacheReadTokens += telemetry.usage.cacheReadTokens;
	totals.cacheWriteTokens += telemetry.usage.cacheWriteTokens;
	totals.totalTokens += telemetry.usage.totalTokens;
	totals.reportedTotalTokens += telemetry.usage.reportedTotalTokens;
	totals.toolCalls += telemetry.usage.toolCalls;
};

const usageTotals = (results: TestResult[], mode?: Mode): UsageTotals => {
	const totals = emptyUsageTotals();
	for (const result of results) {
		for (const modeResult of result.modes) {
			if (mode !== undefined && modeResult.mode !== mode) {
				continue;
			}
			addUsageTotals(totals, modeResult);
		}
	}
	return totals;
};

type ErrorCounts = {
	total: number;
	guardrail: number;
	unhandled: number;
};

const errorCounts = (results: TestResult[], mode?: Mode): ErrorCounts => {
	const counts: ErrorCounts = { total: 0, guardrail: 0, unhandled: 0 };
	for (const result of results) {
		for (const modeResult of result.modes) {
			if (mode !== undefined && modeResult.mode !== mode) {
				continue;
			}
			for (const err of modeResult.errors) {
				counts.total += 1;
				if (err.kind === "guardrail") {
					counts.guardrail += 1;
				} else {
					counts.unhandled += 1;
				}
			}
		}
	}
	return counts;
};

type ErrorAggregate = {
	kind: string;
	dimension: string;
	agentId: string;
	count: number;
};

const errorAggregates = (
	results: TestResult[],
	mode?: Mode,
): ErrorAggregate[] => {
	const counts = new Map<string, ErrorAggregate>();
	for (const result of results) {
		for (const modeResult of result.modes) {
			if (mode !== undefined && modeResult.mode !== mode) {
				continue;
			}
			for (const err of modeResult.errors) {
				const kind = err.kind;
				const dimension = err.kind === "guardrail" ? err.dimension : "-";
				const agentId = "agentId" in err ? err.agentId : "-";
				const key = `${kind}|${dimension}|${agentId}`;
				const existing = counts.get(key);
				if (existing) {
					existing.count += 1;
				} else {
					counts.set(key, { kind, dimension, agentId, count: 1 });
				}
			}
		}
	}
	return [...counts.values()].sort(
		(a, b) =>
			b.count - a.count ||
			a.kind.localeCompare(b.kind) ||
			a.dimension.localeCompare(b.dimension) ||
			a.agentId.localeCompare(b.agentId),
	);
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
	testSpecs: TestSpec[],
	modelInfo: Record<string, ModelInfo>,
): string => {
	const lines: string[] = [];
	lines.push(`# ${heading}`);
	lines.push("");

	lines.push("## Averages across runs");
	lines.push("");
	lines.push(
		"Per model and mode, the mean and sample standard deviation across runs. Columns " +
			`marked ${PURPOSE_MARKER} are computed only from findings matched to a declared ` +
			"manifest purpose, so they measure how well the declared issues were found and " +
			"rated. Unmarked columns are computed from every finding in the report, " +
			"including additional findings that match no declared purpose. Recall is " +
			"detected purposes over declared purposes. Main-target recall counts a purpose " +
			"only when its declared main agent detected it. Corroborated findings count " +
			"detected purposes supported by more than one corroboration unit, which is a " +
			"distinct agent in multi mode or a distinct category in single mode. " +
			"Unmerged duplicates count detected purposes matched to more than one distinct " +
			"finding, which means the deduplicator failed to merge findings describing the " +
			"same issue. " +
			"Actionability rate is the " +
			"share of valid findings with a concrete code change. Dedup reduction rate is " +
			"the share of findings the deduplicator collapsed. Additional findings are valid " +
			"findings not matched to a declared purpose, which is extra coverage rather than " +
			"noise. Invalid findings were marked invalid by the verifier. Valid findings " +
			"exclude invalid ones. Merges and merged sources count deduplicator merges and " +
			"the source findings they absorbed. Overlapping findings and pairs count findings " +
			"whose code changes touch a shared line range, which is not the same as being " +
			"duplicates. Severity and confidence errors are mean absolute differences from " +
			"the manifest. Base score is the severity weight times the confidence weight " +
			"times the agent weight, and score is the base score times the merged factor, " +
			"which is the number of corroboration units capped at three. Base score error " +
			"and score error are the mean absolute differences between the manifest's " +
			"expected value and the reported value. Duration is in minutes " +
			"and tokens are in thousands (K), both per-test totals.",
	);
	lines.push("");

	lines.push(
		`| Model | Mode | Runs | ${metricDefs.map((def) => metricLabel(def)).join(" | ")} |`,
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
			"per-token compute, which differ for mixture-of-experts models. Recall, " +
			"main-target recall, and severity error are computed only from findings matched " +
			"to a declared purpose, while actionability rate, dedup reduction rate, and the " +
			"per-finding efficiency columns are computed from every valid finding in the " +
			"report. Tokens and duration per finding divide the run's total tokens and " +
			"duration by every valid finding the model reported, so a larger model is not " +
			"credited for quality that comes only from spending more.",
	);
	lines.push("");
	lines.push(
		`| Model | Total params (B) | Active params (B) | Mode | Recall ${PURPOSE_MARKER} | Main-target recall ${PURPOSE_MARKER} | Actionability rate | Dedup reduction rate | Severity error ${PURPOSE_MARKER} | Tokens/finding (K) | Duration/finding (min) |`,
	);
	lines.push(
		"| ----- | ---------------- | ----------------- | ---- | ------ | ------------------ | ------------------ | -------------------- | -------------- | ------------------ | ---------------------- |",
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
				`| ${model.model} | ${info?.parameters ?? "n/a"} | ${info?.activeParameters ?? "n/a"} | ${mode} | ${formatStats(statsByMetric.get("recall"), "ratio")} | ${formatStats(statsByMetric.get("mainTargetRecall"), "ratio")} | ${formatStats(statsByMetric.get("actionabilityRate"), "ratio")} | ${formatStats(statsByMetric.get("dedupReductionRate"), "ratio")} | ${formatStats(statsByMetric.get("severityError"), "number")} | ${formatStats(efficiency.tokensPerFinding, "tokens")} | ${formatStats(efficiency.durationPerFinding, "duration")} |`,
			);
		}
	}
	lines.push("");

	lines.push("## Recall by tier");
	lines.push("");
	lines.push(
		"Recall and main-target recall split by fixture difficulty tier, as the mean " +
			"and sample standard deviation across runs. Both are purpose-scoped, computed only " +
			"from findings matched to a declared purpose. Tier describes how hard an issue is to " +
			"spot and is separate from severity, which describes its impact. Tier 1 issues " +
			"are visible in one part of the diff, need no file to confirm, and have one " +
			"obvious correct fix. Tier 2 issues are visible in the diff but their impact " +
			"depends on how the changed code is used elsewhere in the same file, so a " +
			"reviewer may read that file outside the changed hunks but need not reason " +
			"across other files. Tier 3 issues need reasoning across several files or a " +
			"subtle interaction such as concurrency, a transaction boundary, an " +
			"authorization gap, or a hidden N+1 query, and the code looks correct at a glance.",
	);
	lines.push("");
	lines.push(
		`| Model | Mode | Tier | Recall ${PURPOSE_MARKER} | Main-target recall ${PURPOSE_MARKER} |`,
	);
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
			"main target, as the mean and sample standard deviation across runs. Both are " +
			"purpose-scoped, computed only from findings matched to a declared purpose. " +
			"Main-target recall counts a purpose only when that agent detected it.",
	);
	lines.push("");
	lines.push(
		`| Model | Mode | Agent | Recall ${PURPOSE_MARKER} | Main-target recall ${PURPOSE_MARKER} |`,
	);
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
			"reported severity (columns), pooled across runs. This is purpose-scoped, so " +
			"only findings matched to a declared purpose are counted. A diagonal-heavy matrix " +
			"means the model rates severity consistently with the manifest, and off-diagonal " +
			"cells show the direction of any bias.",
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
					`Severity ${PURPOSE_MARKER}`,
				),
			);
		}
	}

	lines.push("## Confidence confusion (expected vs reported)");
	lines.push("");
	lines.push(
		"For each detected purpose, the manifest's expected confidence (rows) against " +
			"the reported confidence (columns), pooled across runs. This is purpose-scoped, " +
			"so only findings matched to a declared purpose are counted. A diagonal-heavy " +
			"matrix means the model rates confidence consistently with the manifest.",
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
					`Confidence ${PURPOSE_MARKER}`,
				),
			);
		}
	}

	lines.push("## Per test across runs");
	lines.push("");
	lines.push(
		"The same per-test metrics summarized across all models and runs. Each row " +
		"merges the available model-run observations for one fixture and mode. Models " +
		"is the number of distinct models represented and runs is the number of " +
		"model-run observations. Values are the mean ± sample standard deviation. Recall and " +
		"unmerged duplicates are purpose-scoped, while additional and invalid findings " +
		"are computed from every finding in the report."
	);
	lines.push("");
	lines.push(
		`| Test | Tier | Mode | Models | Runs | Recall ${PURPOSE_MARKER} | Additional findings | Invalid findings | Unmerged duplicates ${PURPOSE_MARKER} |`,
	);
	lines.push(
		"| ---- | ---- | ---- | ------ | ---- | ------ | ------------------- | ---------------- | --------------------------- |",
	);
	const allTestIds = [
		...new Set(
			models.flatMap((model) =>
				model.runs.flatMap((run) => run.tests.map((test) => test.id)),
			),
		),
	].sort();
	for (const testId of allTestIds) {
		const testEntries = models.flatMap((model) =>
			model.runs.flatMap((run) =>
				run.tests
					.filter((test) => test.id === testId)
					.map((test) => ({ model: model.model, test })),
			),
		);
		for (const mode of modes) {
			const modeEntries = testEntries.flatMap(({ model, test }) =>
				test.modes
					.filter((item) => item.mode === mode)
					.map((result) => ({ model, result })),
			);
			if (modeEntries.length === 0) {
				continue;
			}
			const recall = stats(
				defined(modeEntries.map(({ result }) =>
					result.purposes.length === 0
						? undefined
						: result.purposes.filter((purpose) => purpose.detected).length /
							result.purposes.length,
				)),
			);
			const additional = stats(
				modeEntries.map(({ result }) => result.additionalFindings),
			);
			const invalid = stats(
				modeEntries.map(({ result }) => result.invalidFindings),
			);
			const unmerged = stats(
				modeEntries.map(({ result }) => result.unmergedDuplicates),
			);
			lines.push(
				`| ${testId} | ${testEntries[0].test.tier} | ${mode} | ${new Set(modeEntries.map(({ model }) => model)).size} | ${modeEntries.length} | ${formatStats(recall, "ratio")} | ${formatStats(additional, "number")} | ${formatStats(invalid, "number")} | ${formatStats(unmerged, "number")} |`,
			);
		}
	}
	lines.push("");

	lines.push("## Per test across runs by model");
	lines.push("");
	lines.push(
		"The same per-test metrics summarized across runs. Each row groups one fixture " +
			"and mode for a model. Values are the mean ± sample standard deviation across the " +
			"available runs. Recall and unmerged duplicates are purpose-scoped, while " +
			"additional and invalid findings are computed from every finding in the report.",
	);
	lines.push("");
	lines.push(
		`| Model | Test | Tier | Mode | Runs | Recall ${PURPOSE_MARKER} | Additional findings | Invalid findings | Unmerged duplicates ${PURPOSE_MARKER} |`,
	);
	lines.push(
		"| ----- | ---- | ---- | ---- | ---- | ------ | ------------------- | ---------------- | --------------------------- |",
	);
	for (const model of models) {
		const testIds = [
			...new Set(model.runs.flatMap((run) => run.tests.map((test) => test.id))),
		].sort();
		for (const testId of testIds) {
			const tests = model.runs.flatMap((run) =>
				run.tests.filter((test) => test.id === testId),
			);
			for (const mode of modes) {
				const modeResults = tests.flatMap((test) =>
					test.modes.filter((item) => item.mode === mode),
				);
				if (modeResults.length === 0) {
					continue;
				}
				const recall = stats(
					defined(modeResults.map((result) =>
						result.purposes.length === 0
							? undefined
							: result.purposes.filter((purpose) => purpose.detected).length /
								result.purposes.length,
					)),
				);
				const additional = stats(
					modeResults.map((result) => result.additionalFindings),
				);
				const invalid = stats(
					modeResults.map((result) => result.invalidFindings),
				);
				const unmerged = stats(
					modeResults.map((result) => result.unmergedDuplicates),
				);
				lines.push(
					`| ${model.model} | ${testId} | ${tests[0].tier} | ${mode} | ${modeResults.length} | ${formatStats(recall, "ratio")} | ${formatStats(additional, "number")} | ${formatStats(invalid, "number")} | ${formatStats(unmerged, "number")} |`,
				);
			}
		}
	}
	lines.push("");

	lines.push("## Per test");
	lines.push("");
	lines.push(
		"Recall, additional findings, and invalid findings for each test, run, and mode, " +
			"so individual tests can be inspected. Recall is purpose-scoped, computed only " +
			"from findings matched to a declared purpose, while additional and invalid " +
			"findings are computed from every finding in the report. Unmerged duplicates " +
			"counts purposes matched to more than one distinct finding, which means the " +
			"deduplicator failed to merge findings describing the same issue.",
	);
	lines.push("");
	lines.push(
		`| Model | Run | Test | Tier | Mode | Recall ${PURPOSE_MARKER} | Additional findings | Invalid findings | Unmerged duplicates ${PURPOSE_MARKER} |`,
	);
	lines.push(
		"| ----- | --- | ---- | ---- | ---- | ------ | ------------------- | ---------------- | --------------------------- |",
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
						`| ${model.model} | ${run.runIndex} | ${result.id} | ${result.tier} | ${modeResult.mode} | ${recall} | ${modeResult.additionalFindings} | ${modeResult.invalidFindings} | ${modeResult.unmergedDuplicates} |`,
					);
				}
			}
		}
	}
	lines.push("");

	lines.push("## Unmerged duplicates (deduplicator misses)");
	lines.push("");
	lines.push(
		"A purpose matched to more than one distinct finding means several findings " +
			"describe the same issue but the deduplicator did not merge them. This is a " +
			"deduplicator failure, not a reviewer failure. A match to several source ids " +
			"that all resolve to one merged finding is not counted here, because the " +
			"deduplicator did merge them. Each row lists the distinct finding ids the " +
			"purpose resolved to.",
	);
	lines.push("");
	lines.push(
		`| Model | Run | Test | Mode | Purpose | Main agent | Findings |`,
	);
	lines.push("| ----- | --- | ---- | ---- | ------- | ---------- | -------- |");
	let unmergedDuplicateRows = 0;
	for (const model of models) {
		for (const run of model.runs) {
			for (const result of run.tests) {
				for (const modeResult of result.modes) {
					for (const purpose of modeResult.purposes) {
						if (!purpose.unmergedDuplicate) {
							continue;
						}
						unmergedDuplicateRows += 1;
						lines.push(
							`| ${model.model} | ${run.runIndex} | ${result.id} | ${modeResult.mode} | ${purpose.purposeId} | ${purpose.mainAgent} | ${purpose.matchedFindingIds.join(", ")} |`,
						);
					}
				}
			}
		}
	}
	if (unmergedDuplicateRows === 0) {
		lines.push("| - | - | - | - | - | - | - |");
	}
	lines.push("");

	lines.push("## Deduplication and overlap per test");
	lines.push("");
	lines.push(
		"Deduplication and overlap for each test, run, and mode, computed from every " +
			"finding in the report rather than only purpose-matched findings. Merges is the " +
			"number of " +
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
			"(loss) purposes than single mode, pooled across runs. This section is " +
			"purpose-scoped, so only findings matched to a declared purpose are counted. " +
			"Win rate is wins over " +
			"decided pairs. Corroborated counts detected purposes supported by more than one " +
			"corroboration unit, which is a distinct agent in multi mode or a distinct " +
			"category in single mode.",
	);
	lines.push("");
	lines.push(
		`| Model | Wins | Ties | Losses | Win rate (decided) ${PURPOSE_MARKER} | Corroborated (multi) ${PURPOSE_MARKER} | Corroborated (single) ${PURPOSE_MARKER} |`,
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
		"| Model | Run | Test | Multi duration (min) | Single duration (min) | Multi tokens (K) | Single tokens (K) | Multi continuations | Single continuations |",
	);
	lines.push(
		"| ----- | --- | ---- | -------------------- | --------------------- | ---------------- | ----------------- | ------------------- | -------------------- |",
	);
	for (const model of models) {
		for (const run of model.runs) {
			for (const result of run.tests) {
				const multi = result.modes.find((item) => item.mode === "multi");
				const single = result.modes.find((item) => item.mode === "single");
				lines.push(
					`| ${model.model} | ${run.runIndex} | ${result.id} | ${formatDuration(multi?.telemetry?.durationMs)} | ${formatDuration(single?.telemetry?.durationMs)} | ${formatTokens(multi?.telemetry?.usage.totalTokens)} | ${formatTokens(single?.telemetry?.usage.totalTokens)} | ${totalContinuations(multi)} | ${totalContinuations(single)} |`,
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

	lines.push("## Total usage");
	lines.push("");
	lines.push(
		"Total tokens and duration spent across every test, run, and mode, summed " +
			"rather than averaged. Tests is the number of test-mode runs included. " +
			"Input, output, cache read, and cache write tokens are summed across agents. " +
			"Total tokens is the sum of those four, and reported total tokens is the " +
			"provider-reported figure, which can differ when caching is involved. Tool " +
			"calls is the total number of tool invocations. The final row is the grand " +
			"total across all models and modes.",
	);
	lines.push("");
	lines.push(
		"| Model | Mode | Tests | Duration (min) | Input tokens (K) | Output tokens (K) | Cache read tokens (K) | Cache write tokens (K) | Total tokens (K) | Reported total tokens (K) | Tool calls |",
	);
	lines.push(
		"| ----- | ---- | ----- | -------------- | ---------------- | ----------------- | --------------------- | ---------------------- | ---------------- | ------------------------- | ---------- |",
	);
	const grandTotal = emptyUsageTotals();
	for (const model of models) {
		for (const mode of modes) {
			const totals = usageTotals(modelTests(model), mode);
			if (totals.tests === 0) {
				continue;
			}
			grandTotal.tests += totals.tests;
			grandTotal.durationMs += totals.durationMs;
			grandTotal.inputTokens += totals.inputTokens;
			grandTotal.outputTokens += totals.outputTokens;
			grandTotal.cacheReadTokens += totals.cacheReadTokens;
			grandTotal.cacheWriteTokens += totals.cacheWriteTokens;
			grandTotal.totalTokens += totals.totalTokens;
			grandTotal.reportedTotalTokens += totals.reportedTotalTokens;
			grandTotal.toolCalls += totals.toolCalls;
			lines.push(
				`| ${model.model} | ${mode} | ${totals.tests} | ${formatDuration(totals.durationMs)} | ${formatTokens(totals.inputTokens)} | ${formatTokens(totals.outputTokens)} | ${formatTokens(totals.cacheReadTokens)} | ${formatTokens(totals.cacheWriteTokens)} | ${formatTokens(totals.totalTokens)} | ${formatTokens(totals.reportedTotalTokens)} | ${totals.toolCalls} |`,
			);
		}
	}
	lines.push(
		`| **Total** | all | ${grandTotal.tests} | ${formatDuration(grandTotal.durationMs)} | ${formatTokens(grandTotal.inputTokens)} | ${formatTokens(grandTotal.outputTokens)} | ${formatTokens(grandTotal.cacheReadTokens)} | ${formatTokens(grandTotal.cacheWriteTokens)} | ${formatTokens(grandTotal.totalTokens)} | ${formatTokens(grandTotal.reportedTotalTokens)} | ${grandTotal.toolCalls} |`,
	);
	lines.push("");

	lines.push("## Errors");
	lines.push("");
	lines.push(
		"Workflow errors recorded per model and mode, summed across runs. Guardrail " +
			"errors mean an agent was terminated for hitting a limit, and the dimension " +
			"breakdown below shows which limit. A model that repeatedly hits output_tokens " +
			"tends to overthink, while input_tokens suggests it reads too much context and " +
			"tool_loop or tool_failure suggests it gets stuck. Unhandled errors are " +
			"exceptions that escaped the workflow. The final row is the grand total.",
	);
	lines.push("");
	lines.push(
		"| Model | Mode | Total errors | Guardrail errors | Unhandled errors |",
	);
	lines.push(
		"| ----- | ---- | ------------ | ---------------- | ---------------- |",
	);
	const grandErrors: ErrorCounts = { total: 0, guardrail: 0, unhandled: 0 };
	for (const model of models) {
		for (const mode of modes) {
			const counts = errorCounts(modelTests(model), mode);
			if (counts.total === 0) {
				continue;
			}
			grandErrors.total += counts.total;
			grandErrors.guardrail += counts.guardrail;
			grandErrors.unhandled += counts.unhandled;
			lines.push(
				`| ${model.model} | ${mode} | ${counts.total} | ${counts.guardrail} | ${counts.unhandled} |`,
			);
		}
	}
	lines.push(
		`| **Total** | all | ${grandErrors.total} | ${grandErrors.guardrail} | ${grandErrors.unhandled} |`,
	);
	lines.push("");

	lines.push("## Errors by dimension and agent");
	lines.push("");
	lines.push(
		"Guardrail and unhandled errors grouped by kind, dimension, and agent, pooled " +
			"across runs and sorted by count. Dimension is the guardrail limit that was " +
			"hit, and agent is the agent that was terminated.",
	);
	lines.push("");
	lines.push("| Model | Mode | Kind | Dimension | Agent | Count |");
	lines.push("| ----- | ---- | ---- | --------- | ----- | ----- |");
	for (const model of models) {
		for (const mode of modes) {
			for (const aggregate of errorAggregates(modelTests(model), mode)) {
				lines.push(
					`| ${model.model} | ${mode} | ${aggregate.kind} | ${aggregate.dimension} | ${aggregate.agentId} | ${aggregate.count} |`,
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

	lines.push("## Test specs");
	lines.push("");
	lines.push(
		"The specification and size of each fixture. MR describes the change represented by " +
			"the fixture. Diff size is bytes, diff lines is the line count, and changed files " +
			"is the number of files the diff touches.",
	);
	lines.push("");
	lines.push("| Test | Tier | MR | Diff size (bytes) | Diff lines | Changed files |");
	lines.push("| ---- | ---- | -- | ----------------- | ---------- | ------------- |");
	for (const spec of testSpecs) {
		lines.push(
			`| ${spec.id} | ${spec.tier} | ${spec.mr} | ${spec.bytes} | ${spec.lines} | ${spec.changedFiles} |`,
		);
	}
	lines.push("");

	return lines.join("\n");
};

const main = async (): Promise<void> => {
	const manifests = await findManifests();
	const testSpecs = await findTestSpecs(manifests);
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
		testSpecs,
		modelInfo,
	);
	await writeFile(join(resultsRoot, "summary.md"), combined, "utf8");
	await writeFile(
		join(resultsRoot, "summary.json"),
		JSON.stringify({ models, testSpecs, modelInfo }, null, 2),
		"utf8",
	);

	for (const model of models) {
		const perModel = buildSummary(
			[model],
			`Fixture evaluation summary: ${model.model}`,
			testSpecs,
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
