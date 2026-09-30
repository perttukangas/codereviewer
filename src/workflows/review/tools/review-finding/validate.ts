import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

import type { ReviewFinding } from "../../types.js";
import type { ReviewFindingInput } from "./schema.js";

export const validateFinding = async (
	finding: ReviewFindingInput,
	repoDir: string,
	findings: ReviewFinding[],
	excludeId?: string,
	codeChangeSources?: ReviewFinding[],
): Promise<Omit<ReviewFinding, "id">> => {
	validateUniqueTitle(findings, finding.title, excludeId);

	const codeChange = await normalizeCodeChange(
		finding,
		repoDir,
		codeChangeSources,
	);

	const relatedFiles = await normalizeFilePaths(
		finding.relatedFiles,
		codeChange.codeChangeFilePath,
		repoDir,
	);

	return {
		...finding,
		relatedFiles,
		...codeChange,
	};
};

const normalizeFilePaths = async (
	filePaths: string[],
	codeChangeFilePath: string | undefined,
	repoDir: string,
): Promise<string[]> => {
	const candidates = codeChangeFilePath
		? [...filePaths, codeChangeFilePath]
		: filePaths;

	const normalized = await Promise.all(
		candidates.map((filePath) => validateFilePath(filePath, repoDir)),
	);

	return [...new Set(normalized)];
};

const normalizeCodeChange = async (
	finding: ReviewFindingInput,
	repoDir: string,
	codeChangeSources?: ReviewFinding[],
): Promise<Partial<ReviewFinding>> => {
	const { codeChangeFilePath, codeChangeOldText, codeChangeNewText } = finding;
	const provided = [
		codeChangeFilePath,
		codeChangeOldText,
		codeChangeNewText,
	].filter((value) => value !== undefined).length;

	if (provided === 0) {
		return {};
	}

	if (provided !== 3) {
		throw new Error(
			"Provide codeChangeFilePath, codeChangeOldText, and codeChangeNewText together, or omit all three.",
		);
	}

	if (codeChangeSources) {
		validateCodeChangeSource(
			{
				codeChangeFilePath: codeChangeFilePath as string,
				codeChangeOldText: codeChangeOldText as string,
				codeChangeNewText: codeChangeNewText as string,
			},
			codeChangeSources,
		);
	}

	const filePath = await readRepositoryFile(
		codeChangeFilePath as string,
		repoDir,
	);
	const oldText = codeChangeOldText as string;
	const newText = codeChangeNewText as string;

	if (oldText.length === 0) {
		throw new Error(
			`codeChangeOldText must not be empty in ${filePath.relativePath}.`,
		);
	}

	const matchIndex = findUniqueMatch(
		filePath.content,
		oldText,
		filePath.relativePath,
	);

	if (newText === oldText) {
		throw new Error(
			`No change made in ${filePath.relativePath}. codeChangeNewText is identical to codeChangeOldText. The replacement must produce different content.`,
		);
	}

	return {
		codeChangeFilePath: filePath.relativePath,
		codeChangeOldText,
		codeChangeNewText,
		codeChangeStartLine: getLineNumber(filePath.content, matchIndex),
		codeChangeEndLine: getEndLineNumber(filePath.content, matchIndex, oldText),
	};
};

const validateCodeChangeSource = (
	codeChange: Required<
		Pick<
			ReviewFinding,
			"codeChangeFilePath" | "codeChangeOldText" | "codeChangeNewText"
		>
	>,
	sources: ReviewFinding[],
): void => {
	const matches = sources.some(
		(source) =>
			source.codeChangeFilePath === codeChange.codeChangeFilePath &&
			source.codeChangeOldText === codeChange.codeChangeOldText &&
			source.codeChangeNewText === codeChange.codeChangeNewText,
	);

	if (matches) {
		return;
	}

	const available = sources
		.filter((source) => source.codeChangeFilePath !== undefined)
		.map((source) => source.id);

	throw new Error(
		available.length > 0
			? `codeChange must exactly match the code change of one of the merged findings, or be omitted. Findings with a code change: ${available.join(", ")}.`
			: "codeChange must exactly match the code change of one of the merged findings, or be omitted. None of the merged findings has a code change.",
	);
};

const readRepositoryFile = async (
	findingFilePath: string,
	repoDir: string,
): Promise<{ relativePath: string; content: string }> => {
	const { absolutePath, relativePath } = resolveRepositoryPath(
		findingFilePath,
		repoDir,
	);

	try {
		return { relativePath, content: await readFile(absolutePath, "utf8") };
	} catch {
		throw new Error(`File does not exist: ${findingFilePath}`);
	}
};

const findUniqueMatch = (
	content: string,
	oldText: string,
	relativePath: string,
): number => {
	const firstMatch = content.indexOf(oldText);

	if (firstMatch === -1) {
		throw new Error(
			`Could not find codeChangeOldText in ${relativePath}. The text must match the file exactly, including all whitespace and newlines. Copy it verbatim from the file.`,
		);
	}

	const occurrences = countOccurrences(content, oldText);
	if (occurrences > 1) {
		throw new Error(
			`Found ${occurrences} occurrences of codeChangeOldText in ${relativePath}. The text must be unique. Add surrounding context to make it unique.`,
		);
	}

	return firstMatch;
};

const countOccurrences = (content: string, oldText: string): number =>
	content.split(oldText).length - 1;

const getLineNumber = (content: string, index: number): number =>
	content.slice(0, index).split("\n").length;

const getEndLineNumber = (
	content: string,
	startIndex: number,
	oldText: string,
): number => {
	const matchedText = content.slice(startIndex, startIndex + oldText.length);
	const lineBreaks = matchedText.match(/\n/g)?.length ?? 0;
	const endsAtLineBreak = matchedText.endsWith("\n");
	return (
		getLineNumber(content, startIndex) + lineBreaks - (endsAtLineBreak ? 1 : 0)
	);
};

const validateFilePath = async (
	findingFilePath: string,
	repoDir: string,
): Promise<string> => {
	const { absolutePath, relativePath } = resolveRepositoryPath(
		findingFilePath,
		repoDir,
	);

	try {
		await readFile(absolutePath, "utf8");
	} catch {
		throw new Error(`File does not exist: ${findingFilePath}`);
	}

	return relativePath;
};

const resolveRepositoryPath = (
	findingFilePath: string,
	repoDir: string,
): { absolutePath: string; relativePath: string } => {
	const absolutePath = resolve(repoDir, findingFilePath);
	const resolvedRepoDir = resolve(repoDir);
	const relativePath = relative(resolvedRepoDir, absolutePath);
	if (
		isAbsolute(relativePath) ||
		relativePath === ".." ||
		relativePath.startsWith(`..${sep}`)
	) {
		throw new Error(`File path is outside the repository: ${findingFilePath}`);
	}

	return {
		absolutePath,
		relativePath: relativePath.split(sep).join("/"),
	};
};

const validateUniqueTitle = (
	findings: ReviewFinding[],
	title: string,
	excludeId?: string,
): void => {
	const normalizedTitle = title.trim().toLowerCase();
	const duplicate = findings.some(
		(finding) =>
			finding.id !== excludeId &&
			finding.title.trim().toLowerCase() === normalizedTitle,
	);

	if (duplicate) {
		throw new Error(
			`A review finding with the same title already exists: ${title}`,
		);
	}
};
