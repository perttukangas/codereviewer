import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentUsage } from "../src/runtime/types.ts";
import {
	baseScore,
	corroborationUnits,
	mergedFactor,
	ReviewSeverity,
	round2,
	severityRank,
} from "../src/workflows/review/shared/scoring.ts";
import type {
	ReviewFinding,
	ReviewReport,
} from "../src/workflows/review/types.ts";
import type { WorkflowResult } from "../src/workflows/types.ts";

type Difficulty = "easier" | "medium" | "harder";

type Mode = "multi" | "single";

const modes: Mode[] = ["multi", "single"];

type Purpose = {
	id: string;
	mainAgent: string;
	severity: ReviewSeverity;
	confidence: number;
	score: number;
	title?: string;
	expectedFiles?: string[];
	expectedLines?: [number, number];
};

type Manifest = {
	id: string;
	repository: string;
	revision: string;
	difficulty: Difficulty;
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

	for (const difficulty of ["easier", "medium", "harder"] as const) {
		const difficultyDir = join(diffsRoot, difficulty);
		const entries = await readdir(difficultyDir, { withFileTypes: true }).catch(
			() => [],
		);

		for (const entry of entries) {
			if (!entry.isDirectory() || !entry.name.startsWith("T")) {
				continue;
			}
			const dir = join(difficultyDir, entry.name);
			const manifest = await readJson<Manifest>(join(dir, "manifest.json"));
			if (manifest) {
				found.push({ manifest, dir });
			}
		}
	}

	return found.sort((a, b) => a.manifest.id.localeCompare(b.manifest.id));
};

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
	severityError?: number;
	confidenceError?: number;
	baseScoreError?: number;
	scoreError?: number;
};

type ModeResult = {
	mode: Mode;
	purposes: PurposeResult[];
	additionalFindings: number;
	missingMatches: boolean;
	telemetry?: {
		durationMs: number;
		usage: AgentUsage;
	};
};

type TestResult = {
	id: string;
	difficulty: Difficulty;
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
						(item.finding.scope ?? []).some(
							(scope) => scope === purpose.mainAgent,
						),
					)
				: detectingAgents.includes(purpose.mainAgent);
		const primaryEntry = resolved[0];
		const primary = primaryEntry?.finding;
		const primaryUnits = primaryEntry
			? corroborationUnits(
					primaryEntry.agentId,
					primaryEntry.finding.scope,
					primaryEntry.finding.mergedFrom,
				)
			: [];

		return {
			purposeId: purpose.id,
			mainAgent: purpose.mainAgent,
			detected: resolved.length > 0,
			mainTargetDetected,
			detectingAgents,
			severityError: primary
				? Math.abs(
						severityRank(purpose.severity) - severityRank(primary.severity),
					)
				: undefined,
			confidenceError: primary
				? round2(Math.abs(purpose.confidence - primary.confidence))
				: undefined,
			baseScoreError: primary
				? round2(
						Math.abs(
							purpose.score -
								baseScore(
									primary.severity,
									primary.confidence,
									purpose.mainAgent,
									primary.scope,
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
				return [id, ...(resolved?.finding.mergedFindingIds ?? [])];
			}),
		),
	);
	const additionalFindings = Object.values(report)
		.flatMap((review) => review.findings)
		.filter(
			(finding) =>
				finding.invalidReason === undefined &&
				!matchedFindingIds.has(finding.id),
		).length;

	return {
		mode,
		purposes,
		additionalFindings,
		missingMatches: matches === undefined,
		telemetry: result.telemetry
			? {
					durationMs: result.telemetry.durationMs,
					usage: result.telemetry.usage,
				}
			: undefined,
	};
};

const evaluateTest = async (
	manifest: Manifest,
	_dir: string,
): Promise<TestResult | undefined> => {
	const modeResults: ModeResult[] = [];

	for (const mode of modes) {
		const reportPath = join(resultsRoot, manifest.id, `report.${mode}.json`);
		const matchesPath = join(resultsRoot, manifest.id, `matches.${mode}.json`);

		const result = await readJson<WorkflowResult<ReviewReport>>(reportPath);
		if (!result) {
			console.warn(
				`Skipping ${manifest.id} ${mode}, no report at ${reportPath}`,
			);
			continue;
		}

		const matches = await readJson<Matches>(matchesPath);
		modeResults.push(evaluateMode(manifest, mode, result, matches));
	}

	if (modeResults.length === 0) {
		return undefined;
	}

	return {
		id: manifest.id,
		difficulty: manifest.difficulty,
		modes: modeResults,
	};
};

const ratio = (numerator: number, denominator: number): string =>
	denominator === 0 ? "n/a" : `${numerator}/${denominator}`;

const mean = (values: number[]): string =>
	values.length === 0
		? "n/a"
		: (values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2);

const modeResults = (results: TestResult[], mode: Mode): ModeResult[] =>
	results.flatMap((result) =>
		result.modes.filter((item) => item.mode === mode),
	);

const modePurposes = (results: TestResult[], mode: Mode): PurposeResult[] =>
	modeResults(results, mode).flatMap((result) => result.purposes);

const defined = (values: (number | undefined)[]): number[] =>
	values.filter((value): value is number => value !== undefined);

const buildSummary = (results: TestResult[]): string => {
	const lines: string[] = [];
	lines.push("# Fixture evaluation summary");
	lines.push("");

	lines.push("## Overall");
	lines.push("");
	lines.push(
		"| Mode | Tests | Recall | Main-target recall | Additional findings | Mean severity error | Mean confidence error | Mean base score error | Mean score error | Mean duration (ms) | Mean total tokens |",
	);
	lines.push(
		"| ---- | ----- | ------ | ------------------ | ------------------- | ------------------- | --------------------- | --------------------- | ---------------- | ----------------- | ----------------- |",
	);
	for (const mode of modes) {
		const modeTests = modeResults(results, mode);
		const purposes = modePurposes(results, mode);
		const detected = purposes.filter((purpose) => purpose.detected);
		const mainDetected = purposes.filter(
			(purpose) => purpose.mainTargetDetected,
		);
		const additionalFindings = modeTests.reduce(
			(sum, result) => sum + result.additionalFindings,
			0,
		);
		const durations = defined(
			modeTests.map((result) => result.telemetry?.durationMs),
		);
		const tokens = defined(
			modeTests.map((result) => result.telemetry?.usage.totalTokens),
		);

		lines.push(
			`| ${mode} | ${modeTests.length} | ${ratio(detected.length, purposes.length)} | ${ratio(mainDetected.length, purposes.length)} | ${additionalFindings} | ${mean(defined(purposes.map((purpose) => purpose.severityError)))} | ${mean(defined(purposes.map((purpose) => purpose.confidenceError)))} | ${mean(defined(purposes.map((purpose) => purpose.baseScoreError)))} | ${mean(defined(purposes.map((purpose) => purpose.scoreError)))} | ${mean(durations)} | ${mean(tokens)} |`,
		);
	}
	lines.push("");

	lines.push("## Recall by difficulty");
	lines.push("");
	lines.push("| Mode | Difficulty | Recall | Main-target recall |");
	lines.push("| ---- | ---------- | ------ | ------------------ |");
	for (const mode of modes) {
		for (const difficulty of ["easier", "medium", "harder"] as const) {
			const purposes = results
				.filter((result) => result.difficulty === difficulty)
				.flatMap((result) =>
					result.modes
						.filter((item) => item.mode === mode)
						.flatMap((item) => item.purposes),
				);
			lines.push(
				`| ${mode} | ${difficulty} | ${ratio(
					purposes.filter((purpose) => purpose.detected).length,
					purposes.length,
				)} | ${ratio(
					purposes.filter((purpose) => purpose.mainTargetDetected).length,
					purposes.length,
				)} |`,
			);
		}
	}
	lines.push("");

	lines.push("## Recall by main agent");
	lines.push("");
	lines.push("| Mode | Agent | Recall | Main-target recall |");
	lines.push("| ---- | ----- | ------ | ------------------ |");
	for (const mode of modes) {
		const purposes = modePurposes(results, mode);
		const agents = [
			...new Set(purposes.map((purpose) => purpose.mainAgent)),
		].sort();
		for (const agent of agents) {
			const agentPurposes = purposes.filter(
				(purpose) => purpose.mainAgent === agent,
			);
			lines.push(
				`| ${mode} | ${agent} | ${ratio(
					agentPurposes.filter((purpose) => purpose.detected).length,
					agentPurposes.length,
				)} | ${ratio(
					agentPurposes.filter((purpose) => purpose.mainTargetDetected).length,
					agentPurposes.length,
				)} |`,
			);
		}
	}
	lines.push("");

	lines.push("## Per test");
	lines.push("");
	lines.push("| Test | Difficulty | Mode | Recall | Additional findings |");
	lines.push("| ---- | ---------- | ---- | ------ | ------------------- |");
	for (const result of results) {
		for (const modeResult of result.modes) {
			lines.push(
				`| ${result.id} | ${result.difficulty} | ${modeResult.mode} | ${ratio(
					modeResult.purposes.filter((purpose) => purpose.detected).length,
					modeResult.purposes.length,
				)} | ${modeResult.additionalFindings} |`,
			);
		}
	}
	lines.push("");

	lines.push("## Telemetry (multi vs single)");
	lines.push("");
	lines.push(
		"| Test | Multi duration (ms) | Single duration (ms) | Multi tokens | Single tokens |",
	);
	lines.push(
		"| ---- | ------------------- | -------------------- | ------------ | ------------- |",
	);
	for (const result of results) {
		const multi = result.modes.find((item) => item.mode === "multi");
		const single = result.modes.find((item) => item.mode === "single");
		lines.push(
			`| ${result.id} | ${multi?.telemetry?.durationMs ?? "n/a"} | ${single?.telemetry?.durationMs ?? "n/a"} | ${multi?.telemetry?.usage.totalTokens ?? "n/a"} | ${single?.telemetry?.usage.totalTokens ?? "n/a"} |`,
		);
	}
	lines.push("");

	const missing = results.flatMap((result) =>
		result.modes
			.filter((modeResult) => modeResult.missingMatches)
			.map((modeResult) => `${result.id} (${modeResult.mode})`),
	);
	if (missing.length > 0) {
		lines.push("## Missing matches.json");
		lines.push("");
		lines.push(
			`The following test modes have no matches file and were counted as undetected: ${missing.join(", ")}`,
		);
		lines.push("");
	}

	return lines.join("\n");
};

const main = async (): Promise<void> => {
	const manifests = await findManifests();
	const results: TestResult[] = [];

	for (const { manifest, dir } of manifests) {
		const result = await evaluateTest(manifest, dir);
		if (result) {
			results.push(result);
		}
	}

	if (results.length === 0) {
		console.warn("No evaluated tests. Run fixtures:run first.");
		return;
	}

	const summary = buildSummary(results);
	await writeFile(join(resultsRoot, "summary.md"), summary, "utf8");
	await writeFile(
		join(resultsRoot, "summary.json"),
		JSON.stringify({ results }, null, 2),
		"utf8",
	);

	console.log(summary);
};

await main();
