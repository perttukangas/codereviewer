import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { ReviewFinding } from "../agent-runtime/types.js";

const severityValues = ["critical", "high", "medium", "low", "info"] as const;

const reviewFindingSchema = Type.Object({
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
	filePaths: Type.Array(
		Type.String({
			minLength: 1,
			description: "Repository-relative path of the file.",
		}),
		{
			minItems: 1,
			description: "One or more exact file paths supporting the same finding.",
		},
	),
	problem: Type.String({
		minLength: 1,
		description: "What is wrong, including the relevant failure or risk.",
	}),
	suggestedChange: Type.String({
		minLength: 1,
		description:
			"Specific guidance for fixing the problem. Explain manual or broader fixes here.",
	}),
	rationale: Type.String({
		minLength: 1,
		description:
			"Why the suggested fix is appropriate and what impact it addresses.",
	}),
});

export const createReviewFindingTool = (
	repoDir: string,
	onFinding: (finding: ReviewFinding) => void,
) => {
	const submittedFindings = new Set<string>();

	return defineTool({
		name: "submit_review_finding",
		label: "Submit Review Finding",
		description:
			"Submit one evidence-based code review finding with precise file paths and specific fix guidance.",
		promptSnippet: "Submit structured review findings",
		promptGuidelines: [
			"Use submit_review_finding once for each distinct finding, and call it repeatedly for multiple findings.",
			"Only submit findings that are directly observable in the diffs or can be confirmed through a read-only investigation. Do not invent findings.",
			"If no findings are worth reporting, respond exactly: No reportable issues found.",
			"Use severity critical, high, medium, low, or info according to impact, and set confidence from 0 to 1 according to evidence strength.",
			"Shared severity rubric: CRITICAL means an active or highly likely issue with severe impact that should block release or immediate merge. HIGH means significant risk with clear impact and high confidence that should be fixed before release or in the current change window. MEDIUM means an important issue with meaningful impact that is not release-blocking by itself. LOW means a minor but actionable issue with limited impact. INFO means an improvement note or clarification with minimal direct risk.",
			"After submitting all findings do not provide summary, respond exactly: Review complete.",
		],
		parameters: reviewFindingSchema,
		async execute(_toolCallId, params) {
			await validateFinding(params, repoDir, submittedFindings);
			const finding: ReviewFinding = params;
			submittedFindings.add(findingKey(finding));
			onFinding(finding);

			return {
				content: [{ type: "text", text: "Review finding submitted." }],
				details: finding,
			};
		},
	});
};

const validateFinding = async (
	finding: ReviewFinding,
	repoDir: string,
	submittedFindings: Set<string>,
): Promise<void> => {
	for (const filePath of finding.filePaths) {
		await validateFilePath(filePath, repoDir);
	}

	const key = findingKey(finding);
	if (submittedFindings.has(key)) {
		throw new Error("This review finding was already submitted.");
	}
};

const validateFilePath = async (
	findingFilePath: string,
	repoDir: string,
): Promise<void> => {
	const filePath = resolve(repoDir, findingFilePath);
	const relativePath = relative(resolve(repoDir), filePath);
	if (
		isAbsolute(relativePath) ||
		relativePath === ".." ||
		relativePath.startsWith(`..${sep}`)
	) {
		throw new Error(`File path is outside the repository: ${findingFilePath}`);
	}

	try {
		await readFile(filePath, "utf8");
	} catch {
		throw new Error(`File does not exist: ${findingFilePath}`);
	}
};

const findingKey = (
	finding: Pick<ReviewFinding, "title" | "filePaths">,
): string =>
	JSON.stringify({
		title: finding.title,
		filePaths: finding.filePaths.sort(),
	});
