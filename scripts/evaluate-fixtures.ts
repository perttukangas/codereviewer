import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

type Difficulty = "easier" | "medium" | "harder";

type Severity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO";

type Purpose = {
	id: string;
	mainAgent: string;
	severity: Severity;
	confidence: number;
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

type ReviewFinding = {
	id: string;
	title: string;
	severity: Severity;
	confidence: number;
	invalidReason?: string;
};

type ReviewReport = Record<string, { findings: ReviewFinding[] }>;

type WorkflowResult = {
	output: ReviewReport;
};

type MatchValue = string | string[] | null;

type Matches = Record<string, MatchValue>;

const severityOrder: Severity[] = [
	"CRITICAL",
	"HIGH",
	"MEDIUM",
	"LOW",
	"INFO",
];

const severityRank = (severity: Severity): number =>
	severityOrder.indexOf(severity);

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

const allFindings = (report: ReviewReport): ReviewFinding[] =>
	Object.values(report).flatMap((review) => review.findings);

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
};

type TestResult = {
	id: string;
	difficulty: Difficulty;
	purposes: PurposeResult[];
	falsePositives: number;
	missingMatches: boolean;
};

const evaluateTest = async (
	manifest: Manifest,
	dir: string,
): Promise<TestResult | undefined> => {
	const reportPath = join(resultsRoot, manifest.id, "report.json");
	const matchesPath = join(resultsRoot, manifest.id, "matches.json");

	const result = await readJson<WorkflowResult>(reportPath);
	if (!result) {
		console.warn(`Skipping ${manifest.id}, no report at ${reportPath}`);
		return undefined;
	}

	const matches = await readJson<Matches>(matchesPath);
	const report = result.output;

	const purposes: PurposeResult[] = manifest.diff.purposes.map((purpose) => {
		const matchedIds = toIdList(matches?.[purpose.id] ?? null);
		const resolved = matchedIds
			.map((id) => findFinding(report, id))
			.filter((item): item is { agentId: string; finding: ReviewFinding } =>
				Boolean(item),
			);

		const detectingAgents = [...new Set(resolved.map((item) => item.agentId))];
		const mainTargetDetected = detectingAgents.includes(purpose.mainAgent);
		const primary = resolved[0]?.finding;

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
				? Math.abs(purpose.confidence - primary.confidence)
				: undefined,
		};
	});

	const matchedFindingIds = new Set(
		manifest.diff.purposes.flatMap((purpose) =>
			toIdList(matches?.[purpose.id] ?? null),
		),
	);
	const falsePositives = allFindings(report).filter(
		(finding) =>
			finding.invalidReason === undefined &&
			!matchedFindingIds.has(finding.id),
	).length;

	return {
		id: manifest.id,
		difficulty: manifest.difficulty,
		purposes,
		falsePositives,
		missingMatches: matches === undefined,
	};
};

const ratio = (numerator: number, denominator: number): string =>
	denominator === 0 ? "n/a" : `${numerator}/${denominator}`;

const mean = (values: number[]): string =>
	values.length === 0
		? "n/a"
		: (values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2);

const buildSummary = (results: TestResult[]): string => {
	const lines: string[] = [];
	lines.push("# Fixture evaluation summary");
	lines.push("");

	const allPurposes = results.flatMap((result) => result.purposes);
	const detected = allPurposes.filter((purpose) => purpose.detected);
	const mainDetected = allPurposes.filter((purpose) => purpose.mainTargetDetected);
	const severityErrors = allPurposes
		.map((purpose) => purpose.severityError)
		.filter((value): value is number => value !== undefined);
	const confidenceErrors = allPurposes
		.map((purpose) => purpose.confidenceError)
		.filter((value): value is number => value !== undefined);
	const falsePositives = results.reduce(
		(sum, result) => sum + result.falsePositives,
		0,
	);

	lines.push("## Overall");
	lines.push("");
	lines.push(`- Tests evaluated: ${results.length}`);
	lines.push(`- Recall: ${ratio(detected.length, allPurposes.length)}`);
	lines.push(
		`- Main-target recall: ${ratio(mainDetected.length, allPurposes.length)}`,
	);
	lines.push(`- False positives: ${falsePositives}`);
	lines.push(`- Mean severity error: ${mean(severityErrors)}`);
	lines.push(`- Mean confidence error: ${mean(confidenceErrors)}`);
	lines.push("");

	lines.push("## Recall by difficulty");
	lines.push("");
	lines.push("| Difficulty | Recall | Main-target recall |");
	lines.push("| ---------- | ------ | ------------------ |");
	for (const difficulty of ["easier", "medium", "harder"] as const) {
		const purposes = results
			.filter((result) => result.difficulty === difficulty)
			.flatMap((result) => result.purposes);
		lines.push(
			`| ${difficulty} | ${ratio(
				purposes.filter((purpose) => purpose.detected).length,
				purposes.length,
			)} | ${ratio(
				purposes.filter((purpose) => purpose.mainTargetDetected).length,
				purposes.length,
			)} |`,
		);
	}
	lines.push("");

	lines.push("## Recall by main agent");
	lines.push("");
	lines.push("| Agent | Recall | Main-target recall |");
	lines.push("| ----- | ------ | ------------------ |");
	const agents = [...new Set(allPurposes.map((purpose) => purpose.mainAgent))].sort();
	for (const agent of agents) {
		const purposes = allPurposes.filter(
			(purpose) => purpose.mainAgent === agent,
		);
		lines.push(
			`| ${agent} | ${ratio(
				purposes.filter((purpose) => purpose.detected).length,
				purposes.length,
			)} | ${ratio(
				purposes.filter((purpose) => purpose.mainTargetDetected).length,
				purposes.length,
			)} |`,
		);
	}
	lines.push("");

	lines.push("## Per test");
	lines.push("");
	lines.push("| Test | Difficulty | Recall | False positives |");
	lines.push("| ---- | ---------- | ------ | --------------- |");
	for (const result of results) {
		lines.push(
			`| ${result.id} | ${result.difficulty} | ${ratio(
				result.purposes.filter((purpose) => purpose.detected).length,
				result.purposes.length,
			)} | ${result.falsePositives} |`,
		);
	}
	lines.push("");

	const missing = results.filter((result) => result.missingMatches);
	if (missing.length > 0) {
		lines.push("## Missing matches.json");
		lines.push("");
		lines.push(
			`The following tests have no matches.json and were counted as undetected: ${missing
				.map((result) => result.id)
				.join(", ")}`,
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
