import { readdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, relative } from "node:path";

/**
 * Post-processing for fixture results.
 *
 * Two jobs:
 * 1. Rewrite every machine-specific absolute path in test/fixtures/results. The
 *    machine prefix is replaced by a marker and the llm-workflows checkout name
 *    plus everything under it is kept, so a path such as
 *    /home/user/llm-workflows/test/fixtures/diffs/T03/review.diff becomes
 *    (sanitized)/llm-workflows/test/fixtures/diffs/T03/review.diff. Every
 *    rewritten path carries the marker, so a redacted path is self-describing.
 *    Only known roots are rewritten, so absolute paths that live inside code
 *    text (for example /usr/src/app in a Dockerfile suggestion) are untouched.
 * 2. Detect agent/provider call failures and write test/fixtures/results/anomalies.json
 *    so a failed or degraded run can be inspected. Aborts (expected guardrail
 *    timeouts) are counted but not flagged.
 *
 * Run with: npm run fixtures:sanitize  (add --check to report without writing)
 */

const projectDir = join(import.meta.dirname, "..");
const resultsRoot = join(projectDir, "test", "fixtures", "results");

const checkOnly = process.argv.includes("--check");

// --- Path rewriting ------------------------------------------------------

const projectName = basename(projectDir);

/**
 * Marker prepended to every rewritten path. It states that the machine-specific
 * prefix was removed on purpose, instead of leaving an unexplained fragment.
 */
const unresolvedMarker = "(sanitized)";

// Absolute locations that are not under the llm-workflows checkout. They have no
// llm-workflows segment to keep, so only the marker survives.
const externalRoots = ["/workspace/repository", "/workspace/input"];

// Matches an absolute path whose final named directory is the llm-workflows
// checkout. The leading machine-specific segments are dropped and the checkout
// name plus everything under it is kept, so a prefix on another machine or CI
// works without hardcoding this one.
const checkoutPattern = new RegExp(
	`^(?:/[^/\\s'"()]+)*/(${projectName})(/.*)?$`,
);

const rewriteCore = (token: string): string => {
	for (const root of externalRoots) {
		if (token === root || token.startsWith(`${root}/`)) {
			return unresolvedMarker;
		}
	}

	const match = token.match(checkoutPattern);
	if (!match) {
		return token;
	}
	const rest = (match[2] ?? "").replace(/^\//, "");
	return rest.length === 0
		? unresolvedMarker
		: `${unresolvedMarker}/${match[1]}/${rest}`;
};

const pathSegment = "[^\\s/'\"()\\[\\]{},;:`<>|*?]";
const absoluteToken = new RegExp(`/${pathSegment}+(?:/${pathSegment}+)*`, "g");

const rewriteToken = (token: string): string => {
	const trailing = token.match(/[.!?]+$/)?.[0] ?? "";
	const core = trailing ? token.slice(0, -trailing.length) : token;
	if (!core.startsWith("/")) {
		return token;
	}
	const rewritten = rewriteCore(core);
	return rewritten === core ? token : rewritten + trailing;
};

const rewriteString = (input: string): string =>
	input
		.replace(absoluteToken, (match: string, offset: number) =>
			// An already-sanitized path has the marker directly before the
			// llm-workflows segment, so its leading "/" would otherwise match
			// again. Skip it to keep the rewrite idempotent.
			input
				.slice(Math.max(0, offset - unresolvedMarker.length), offset)
				.endsWith(unresolvedMarker)
				? match
				: rewriteToken(match),
		)
		// Collapse a marker that an earlier non-idempotent run duplicated.
		.replace(/\(sanitized\)(?:\(sanitized\))+/g, () => unresolvedMarker);

type RewriteResult = { value: unknown; changed: boolean };

const rewriteJson = (value: unknown): RewriteResult => {
	if (typeof value === "string") {
		const rewritten = rewriteString(value);
		return { value: rewritten, changed: rewritten !== value };
	}
	if (Array.isArray(value)) {
		let changed = false;
		const next = value.map((item) => {
			const result = rewriteJson(item);
			changed ||= result.changed;
			return result.value;
		});
		return { value: changed ? next : value, changed };
	}
	if (value !== null && typeof value === "object") {
		let changed = false;
		const next: Record<string, unknown> = {};
		for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
			const result = rewriteJson(item);
			changed ||= result.changed;
			next[key] = result.value;
		}
		return { value: changed ? next : value, changed };
	}
	return { value, changed: false };
};

// --- File walking --------------------------------------------------------

const walk = async (dir: string): Promise<string[]> => {
	const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
	const files: string[] = [];
	for (const entry of entries) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) {
			files.push(...(await walk(path)));
		} else if (entry.isFile()) {
			files.push(path);
		}
	}
	return files;
};

const processText = async (path: string): Promise<boolean> => {
	const original = await readFile(path, "utf8");
	const rewritten = rewriteString(original);
	if (rewritten === original) {
		return false;
	}
	if (!checkOnly) {
		await writeFile(path, rewritten, "utf8");
	}
	return true;
};

const processJson = async (path: string): Promise<boolean> => {
	const original = await readFile(path, "utf8");
	let parsed: unknown;
	try {
		parsed = JSON.parse(original);
	} catch {
		return processText(path);
	}
	const result = rewriteJson(parsed);
	if (!result.changed) {
		return false;
	}
	if (!checkOnly) {
		await writeFile(path, JSON.stringify(result.value, null, 2), "utf8");
	}
	return true;
};

// --- Anomaly detection ---------------------------------------------------

type Anomaly = {
	category: "provider_error" | "unhandled_exception";
	model: string;
	run: number;
	test: string;
	mode: string;
	agent?: string;
	reason?: string;
	message: string;
	locations: { file: string; line?: number }[];
	timestamp?: string;
};

type Counts = {
	providerError: number;
	abort: number;
	toolFailure: number;
	unhandledException: number;
};

const counts: Counts = {
	providerError: 0,
	abort: 0,
	toolFailure: 0,
	unhandledException: 0,
};

const anomalies: Anomaly[] = [];

// Lines are written to both the per-agent log and combined.log, so the same
// event is seen twice. Keying on timestamp, agent, and text collapses the copy.
const countedEvents = new Set<string>();
const anomalyByEvent = new Map<string, number>();

const bump = (key: string, field: keyof Counts): void => {
	if (countedEvents.has(key)) {
		return;
	}
	countedEvents.add(key);
	counts[field] += 1;
};

const linePattern =
	/^\[(\d{4}-\d{2}-\d{2}T[^\]]+)\] \[(?:DEBUG|INFO|ERROR)\](?: \[([^\]]+)\])? (.*)$/;

const extractError = (text: string): string | undefined => {
	const quoted =
		text.match(/\berror:\s*'((?:[^'\\]|\\.)*)'/)?.[1] ??
		text.match(/\berror:\s*"((?:[^"\\]|\\.)*)"/)?.[1];
	if (quoted) {
		return quoted.replace(/\\(['"])/g, "$1");
	}
	return text.match(/\berror:\s*([^,{\n]+)/)?.[1]?.trim();
};

const isAbort = (message: string | undefined): boolean =>
	message !== undefined && /abort/i.test(message);

const reasonPatterns: [RegExp, string][] = [
	[/\b(?:429|rate[_ ]limit|too many requests)\b/i, "rate_limit"],
	[
		/\b(?:5\d\d|overloaded|unavailable|bad gateway|gateway timeout)\b/i,
		"provider_unavailable",
	],
	[/\b4\d\d\b/, "client_error"],
	[
		/stream interrupted|connection .*lost|upstream model server|\bupstream\b/i,
		"upstream_stream",
	],
	[/\b(?:timeout|timed out|ETIMEDOUT)\b/i, "timeout"],
	[/\b(?:ECONNRESET|ECONNREFUSED|EPIPE|socket|network)\b/i, "network"],
	[/\b(?:quota|insufficient)\b/i, "quota"],
	[/\b(?:context length|maximum context|too many tokens)\b/i, "context_limit"],
];

const classifyReason = (message: string): string => {
	for (const [pattern, label] of reasonPatterns) {
		if (pattern.test(message)) {
			return label;
		}
	}
	return "unclassified";
};

const locationPattern =
	/^(.+)\/run-(\d+)\/(T\d+)\/logs\.(multi|single)\/(.+)\.log$/;

/**
 * Records an anomaly once per event and accumulates every file the line appears
 * in. Lines are written to both the per-agent log and combined.log, so an
 * anomaly carries a pointer to each one. The per-agent log is ordered first
 * because it is far smaller and easier to open at the line.
 */
const orderLocations = (
	locations: { file: string; line?: number }[],
): { file: string; line?: number }[] =>
	[...locations].sort((a, b) => {
		const aCombined = a.file.endsWith("/combined.log") ? 1 : 0;
		const bCombined = b.file.endsWith("/combined.log") ? 1 : 0;
		return (
			aCombined - bCombined ||
			a.file.localeCompare(b.file) ||
			(a.line ?? 0) - (b.line ?? 0)
		);
	});

const recordAnomaly = (key: string, anomaly: Anomaly): void => {
	const existingIndex = anomalyByEvent.get(key);
	if (existingIndex === undefined) {
		anomalyByEvent.set(key, anomalies.length);
		anomaly.locations = orderLocations(anomaly.locations);
		anomalies.push(anomaly);
		return;
	}

	const existing = anomalies[existingIndex];
	for (const location of anomaly.locations) {
		if (!existing.locations.some((item) => item.file === location.file)) {
			existing.locations.push(location);
		}
	}
	existing.locations = orderLocations(existing.locations);
};

const scanLog = async (path: string, relPath: string): Promise<void> => {
	const location = relPath.match(locationPattern);
	if (!location) {
		return;
	}
	const [, model, run, test, mode] = location;

	const content = await readFile(path, "utf8");
	const lines = content.split("\n");

	// An error log entry may be pretty-printed across several lines, so join
	// until the braces balance before extracting the error text.
	const blockFor = (start: number): string => {
		let block = lines[start];
		let depth =
			(block.match(/\{/g)?.length ?? 0) - (block.match(/\}/g)?.length ?? 0);
		let cursor = start;
		while (depth > 0 && cursor + 1 < lines.length) {
			cursor += 1;
			block += `\n${lines[cursor]}`;
			depth +=
				(lines[cursor].match(/\{/g)?.length ?? 0) -
				(lines[cursor].match(/\}/g)?.length ?? 0);
		}
		return block;
	};

	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index];
		const parsed = line.match(linePattern);
		if (!parsed) {
			continue;
		}
		const [, timestamp, agentTag, rest] = parsed;
		const agent = agentTag ?? undefined;
		const eventKey = `${timestamp}|${agentTag ?? "-"}|${rest}`;

		const isAgentError =
			rest.includes("Agent message ended with error") ||
			rest.includes("Agent ended with error") ||
			rest.includes("auto_retry_start") ||
			rest.includes("auto_retry_end") ||
			rest.includes("summarization_retry_scheduled");
		const isToolFailure = rest.includes("Tool call failed");

		if (isToolFailure) {
			bump(`tool|${eventKey}`, "toolFailure");
			continue;
		}
		if (!isAgentError) {
			continue;
		}

		const block = rest.includes("{") ? blockFor(index) : rest;
		const message = extractError(block) ?? rest;
		if (isAbort(message)) {
			bump(`abort|${eventKey}`, "abort");
			continue;
		}
		if (rest.includes("auto_retry_end") && /success: true/.test(block)) {
			continue;
		}

		bump(`provider|${eventKey}`, "providerError");
		recordAnomaly(`provider|${eventKey}`, {
			category: "provider_error",
			model,
			run: Number(run),
			test,
			mode,
			...(agent ? { agent } : {}),
			reason: classifyReason(message),
			message,
			locations: [{ file: relPath, line: index + 1 }],
			timestamp,
		});
	}
};

const reportPattern =
	/^(.+)\/run-(\d+)\/(T\d+)\/report\.(multi|single)\.json$/;

type ReportError = {
	kind?: string;
	id?: string;
	agentId?: string;
	name?: string;
	message?: string;
};

const scanReport = async (path: string, relPath: string): Promise<void> => {
	const location = relPath.match(reportPattern);
	if (!location) {
		return;
	}
	const [, model, run, test, mode] = location;

	let parsed: { errors?: ReportError[] };
	try {
		parsed = JSON.parse(await readFile(path, "utf8")) as {
			errors?: ReportError[];
		};
	} catch {
		return;
	}

	for (const error of parsed.errors ?? []) {
		if (error.kind !== "unhandled_exception") {
			continue;
		}
		counts.unhandledException += 1;
		anomalies.push({
			category: "unhandled_exception",
			model,
			run: Number(run),
			test,
			mode,
			...(error.agentId ? { agent: error.agentId } : {}),
			message: [error.name, error.message].filter(Boolean).join(": "),
			locations: [{ file: relPath }],
			...(error.id ? { reason: error.id } : {}),
		});
	}
};

// --- Main ----------------------------------------------------------------

const report = (): void => {
	console.log("");
	console.log("Anomalies");
	console.log(
		`  Provider errors ${counts.providerError}, unhandled exceptions ${counts.unhandledException}, aborts (ignored) ${counts.abort}, tool failures ${counts.toolFailure}`,
	);

	if (anomalies.length > 0) {
		const byReason = new Map<string, number>();
		for (const anomaly of anomalies) {
			const key = `${anomaly.category}/${anomaly.reason ?? "-"}`;
			byReason.set(key, (byReason.get(key) ?? 0) + 1);
		}
		console.log("  By category and reason");
		for (const [key, value] of [...byReason.entries()].sort()) {
			console.log(`    ${key} ${value}`);
		}

		console.log("  Flagged for inspection");
		for (const anomaly of anomalies.slice(0, 50)) {
			const agent = anomaly.agent ? ` ${anomaly.agent}` : "";
			const pointers = anomaly.locations
				.map((location) =>
					location.line
						? `${location.file}:${location.line}`
						: location.file,
				)
				.join(" + ");
			console.log(`    ${pointers}${agent} ${anomaly.message}`);
		}
		if (anomalies.length > 50) {
			console.log(`    ... ${anomalies.length - 50} more in anomalies.json`);
		}
	}
};

const main = async (): Promise<void> => {
	const files = await walk(resultsRoot);
	if (files.length === 0) {
		console.warn(`No results under ${relative(projectDir, resultsRoot)}`);
		return;
	}

	let changed = 0;
	for (const path of files) {
		const wasChanged = path.endsWith(".json")
			? await processJson(path)
			: await processText(path);
		if (wasChanged) {
			changed += 1;
		}
	}

	for (const path of files) {
		const relPath = relative(resultsRoot, path).split("\\").join("/");
		if (relPath.endsWith(".log")) {
			await scanLog(path, relPath);
		} else if (reportPattern.test(relPath)) {
			await scanReport(path, relPath);
		}
	}

	const anomaliesPath = join(resultsRoot, "anomalies.json");
	const payload = {
		generatedAt: new Date().toISOString(),
		resultsRoot: relative(projectDir, resultsRoot),
		counts,
		anomalies,
	};
	if (!checkOnly) {
		await writeFile(anomaliesPath, JSON.stringify(payload, null, 2), "utf8");
	}

	console.log(
		`${checkOnly ? "Checked" : "Rewrote"} ${changed} of ${files.length} files under ${relative(projectDir, resultsRoot)}`,
	);
	report();
	console.log("");
	console.log(
		checkOnly
			? "Dry run. No files were written."
			: `Anomalies written to ${relative(projectDir, anomaliesPath)}`,
	);
};

await main();
