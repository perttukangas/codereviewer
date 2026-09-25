import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

import { Type } from "typebox";
import type {
	ReviewCodeChange,
	ReviewFinding,
	ReviewSeverity,
	ReviewSuggestedChange,
} from "../types.js";

export const severityValues = [
	"critical",
	"high",
	"medium",
	"low",
	"info",
] as const;

export const severityRank = (severity: ReviewSeverity): number =>
	severityValues.indexOf(severity);

export type ReviewCodeChangeInput = Omit<
	ReviewCodeChange,
	"startLine" | "endLine"
>;
export type ReviewSuggestedChangeInput = ReviewSuggestedChange;
export type ReviewFindingInput = Omit<
	ReviewFinding,
	"id" | "suggestedCodeChanges" | "suggestedChange"
> & {
	suggestedChange?: ReviewSuggestedChangeInput;
	suggestedCodeChanges?: ReviewCodeChangeInput[];
};

export const nextId = (items: { id: string }[], prefix: string): string => {
	const idPrefix = `${prefix}-`;
	const highest = items.reduce((max, item) => {
		if (!item.id.startsWith(idPrefix)) {
			return max;
		}
		const suffix = Number.parseInt(item.id.slice(idPrefix.length), 10);
		return Number.isNaN(suffix) ? max : Math.max(max, suffix);
	}, 0);

	return `${idPrefix}${highest + 1}`;
};

export const reviewFindingGuidelines = [
	"Use severity critical, high, medium, low, or info according to impact, and set confidence from 0 to 1 according to evidence strength.",
	"Shared severity rubric: CRITICAL means an active or highly likely issue with severe impact that should block release or immediate merge. HIGH means significant risk with clear impact and high confidence that should be fixed before release or in the current change window. MEDIUM means an important issue with meaningful impact that is not release-blocking by itself. LOW means a minor but actionable issue with limited impact. INFO means an improvement note or clarification with minimal direct risk.",
	"Use suggestedCodeChanges for small, localized issues when you can suggest a concrete code fix, even if you are not entirely confident it is the intended solution.",
	"Use suggestedChange for fixes that are likely multi-step, broad, or cannot be easily represented as a small set of exact code changes; provide suggestedCodeChanges or suggestedChange, never both.",
];

export const reviewCodeChangeSchema = Type.Object({
	filePath: Type.String({
		minLength: 1,
		description: "Repository-relative path of the file to change.",
	}),
	oldText: Type.String({
		minLength: 1,
		description: "Exact text that must occur once in the current file.",
	}),
	newText: Type.String({
		description:
			"Text that replaces the exact oldText. Use an empty string for deletion.",
	}),
});

export const reviewFindingSchema = Type.Object({
	title: Type.String({
		minLength: 1,
		description: "Short, specific title describing the review finding.",
	}),
	severity: Type.Union(
		severityValues.map((value) => Type.Literal(value)),
		{
			description:
				"Impact level. Use CRITICAL, HIGH, MEDIUM, LOW, or INFO according to the shared severity rubric.",
		},
	),
	confidence: Type.Number({
		minimum: 0,
		maximum: 1,
		description:
			"Evidence confidence from 0 to 1. Use 1 for directly demonstrated issues and lower values when assumptions remain.",
	}),
	problem: Type.String({
		minLength: 1,
		description: "What is wrong, including the relevant failure or risk.",
	}),
	suggestedChange: Type.Optional(
		Type.Object({
			filePaths: Type.Array(
				Type.String({
					minLength: 1,
					description: "Repository-relative path of the file.",
				}),
				{
					minItems: 1,
					description:
						"One or more exact file paths affected by the broader fix.",
				},
			),

			explanation: Type.String({
				minLength: 1,
				description:
					"Describe the broader or multi-step fix. Use when the fix cannot be represented as exact text replacements.",
			}),
		}),
	),
	suggestedCodeChanges: Type.Optional(
		Type.Array(reviewCodeChangeSchema, {
			minItems: 1,
			description:
				"Preferred for simple, localized fixes. Provide exact text replacements. Do not provide suggestedChange when using this.",
		}),
	),
	rationale: Type.String({
		minLength: 1,
		description:
			"Why the suggested fix is appropriate and what impact it addresses.",
	}),
});

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

			return {
				...suggestedCodeChange,
				filePath: filePath.relativePath,
				startLine: getLineNumber(filePath.content, matchIndex),
				endLine: getEndLineNumber(
					filePath.content,
					matchIndex,
					suggestedCodeChange.oldText,
				),
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
