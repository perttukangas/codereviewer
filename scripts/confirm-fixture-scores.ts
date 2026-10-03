import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { baseScore, type ReviewSeverity } from "../src/workflows/review/shared/scoring.ts";

type Purpose = {
	id: string;
	mainAgent: string;
	severity: ReviewSeverity;
	confidence: number;
	score?: number;
	title?: string;
	expectedFiles?: string[];
	expectedLines?: [number, number];
};

type Manifest = {
	id: string;
	repository: string;
	revision: string;
	difficulty: "easier" | "medium" | "harder";
	diff: {
		path: string;
		changedFiles: string[];
		purposes: Purpose[];
	};
};

const projectDir = join(import.meta.dirname, "..");
const diffsRoot = join(projectDir, "test", "fixtures", "diffs");

const write = process.argv.includes("--write");

const findManifests = async (): Promise<
	{ manifest: Manifest; path: string }[]
> => {
	const found: { manifest: Manifest; path: string }[] = [];

	for (const difficulty of ["easier", "medium", "harder"] as const) {
		const difficultyDir = join(diffsRoot, difficulty);
		const entries = await readdir(difficultyDir, { withFileTypes: true }).catch(
			() => [],
		);

		for (const entry of entries) {
			if (!entry.isDirectory() || !entry.name.startsWith("T")) {
				continue;
			}
			const path = join(difficultyDir, entry.name, "manifest.json");
			try {
				const manifest = JSON.parse(await readFile(path, "utf8")) as Manifest;
				found.push({ manifest, path });
			} catch {
				// No manifest for this test yet.
			}
		}
	}

	return found.sort((a, b) => a.manifest.id.localeCompare(b.manifest.id));
};

const main = async (): Promise<void> => {
	const manifests = await findManifests();
	let mismatches = 0;

	for (const { manifest, path } of manifests) {
		let changed = false;

		for (const purpose of manifest.diff.purposes) {
			const expected = baseScore(
				purpose.severity,
				purpose.confidence,
				purpose.mainAgent,
			);

			if (purpose.score !== expected) {
				mismatches += 1;
				console.log(
					`${manifest.id} ${purpose.id}: manifest=${purpose.score ?? "missing"} expected=${expected}`,
				);
				if (write) {
					purpose.score = expected;
					changed = true;
				}
			}
		}

		if (write && changed) {
			await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
			console.log(`Updated ${path}`);
		}
	}

	if (mismatches === 0) {
		console.log("All manifest scores match the base-score formula.");
		return;
	}

	if (!write) {
		console.error(
			`\n${mismatches} score mismatch(es). Run with --write to update.`,
		);
		process.exitCode = 1;
	}
};

await main();
