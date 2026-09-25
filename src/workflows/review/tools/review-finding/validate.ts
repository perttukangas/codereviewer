import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

import type { ReviewCodeChange, ReviewFinding } from "../../types.js";
import type { ReviewCodeChangeInput, ReviewFindingInput } from "./schema.js";

export const validateFinding = async (
	finding: ReviewFindingInput,
	repoDir: string,
	findings: ReviewFinding[],
	excludeId?: string,
): Promise<Omit<ReviewFinding, "id">> => {
	validateSuggestion(finding);
	validateUniqueTitle(findings, finding.title, excludeId);

	const suggestedChange = finding.suggestedChange
		? {
				...finding.suggestedChange,
				filePaths: await Promise.all(
					finding.suggestedChange.filePaths.map((filePath) =>
						validateFilePath(filePath, repoDir),
					),
				),
			}
		: undefined;

	const normalizedFinding: Omit<ReviewFinding, "id"> = {
		...finding,
		suggestedChange,
		suggestedCodeChanges: await normalizeCodeChanges(
			finding.suggestedCodeChanges,
			repoDir,
		),
	};

	return normalizedFinding;
};

const normalizeCodeChanges = async (
	suggestedCodeChanges: ReviewCodeChangeInput[] | undefined,
	repoDir: string,
): Promise<ReviewCodeChange[] | undefined> => {
	if (!suggestedCodeChanges) {
		return undefined;
	}

	return Promise.all(
		suggestedCodeChanges.map(async (suggestedCodeChange) => {
			const filePath = await readRepositoryFile(
				suggestedCodeChange.filePath,
				repoDir,
			);
			const matchIndex = findUniqueMatch(
				filePath.content,
				suggestedCodeChange.oldText,
			);

			const additionalFilePaths = suggestedCodeChange.additionalFilePaths
				? await Promise.all(
						suggestedCodeChange.additionalFilePaths.map((additionalPath) =>
							validateFilePath(additionalPath, repoDir),
						),
					)
				: undefined;

			return {
				...suggestedCodeChange,
				filePath: filePath.relativePath,
				startLine: getLineNumber(filePath.content, matchIndex),
				endLine: getEndLineNumber(
					filePath.content,
					matchIndex,
					suggestedCodeChange.oldText,
				),
				additionalFilePaths,
			};
		}),
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

const findUniqueMatch = (content: string, oldText: string): number => {
	const firstMatch = content.indexOf(oldText);
	if (firstMatch === -1 || content.indexOf(oldText, firstMatch + 1) !== -1) {
		throw new Error(
			"suggestedCodeChange.oldText must occur exactly once in the current file.",
		);
	}

	return firstMatch;
};

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

const validateSuggestion = (finding: ReviewFindingInput): void => {
	const hasSuggestedChange = finding.suggestedChange !== undefined;
	const hasCodeChanges = finding.suggestedCodeChanges !== undefined;

	if (hasSuggestedChange === hasCodeChanges) {
		throw new Error(
			"Exactly one of suggestedChange or suggestedCodeChanges must be provided.",
		);
	}
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
