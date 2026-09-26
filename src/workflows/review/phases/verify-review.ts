import { getAgentConfig } from "../../../engine/agent-config.js";
import { runGuardedSession } from "../../../engine/session.js";
import type { Agent } from "../../../engine/types.js";
import { createLogger } from "../../../shared/logger.js";
import type { WorkflowContext } from "../../types.js";
import { createVerifierAgent } from "../agents/verifier.js";
import { toGuardrailError } from "../shared/errors.js";
import { formatVerificationPrompt } from "../shared/prompt.js";
import { createEditReviewFindingTool } from "../tools/edit-review-finding.js";
import { nextId } from "../tools/review-finding/index.js";
import type { AgentReview, ReviewFinding, ReviewRunState } from "../types.js";

const DIFF_HEADER_PREFIX = "diff --git ";

type DiffFile = {
	path: string;
	content: string;
};

const parseDiffPath = (header: string): string => {
	const rest = header.slice(DIFF_HEADER_PREFIX.length).trim();

	const quoted = rest.match(/"b\/(.+)"$/);
	if (quoted) {
		return quoted[1];
	}

	const plain = rest.match(/\sb\/(.+)$/);
	if (plain) {
		return plain[1];
	}

	return rest;
};

const parseDiff = (diff: string): DiffFile[] => {
	const files: DiffFile[] = [];
	let current: { path: string; lines: string[] } | undefined;

	for (const line of diff.split("\n")) {
		if (line.startsWith(DIFF_HEADER_PREFIX)) {
			if (current) {
				files.push({ path: current.path, content: current.lines.join("\n") });
			}
			current = { path: parseDiffPath(line), lines: [line] };
			continue;
		}

		if (current) {
			current.lines.push(line);
		}
	}

	if (current) {
		files.push({ path: current.path, content: current.lines.join("\n") });
	}

	return files;
};

const selectDiffFiles = (diff: string, paths: string[]): string => {
	if (paths.length === 0) {
		return diff;
	}

	const wanted = new Set(paths);
	const selected = parseDiff(diff).filter((file) => wanted.has(file.path));

	return selected.map((file) => file.content).join("\n");
};

const findingFilePaths = (findings: ReviewFinding[]): string[] => {
	const paths = new Set<string>();

	for (const finding of findings) {
		for (const filePath of finding.relatedFiles ?? []) {
			paths.add(filePath);
		}
		const codeChangeFilePath = finding.codeChangeFilePath;
		if (codeChangeFilePath) {
			paths.add(codeChangeFilePath);
		}
	}

	return [...paths];
};

export const verifyReview = async (
	context: WorkflowContext,
	reviewer: Agent,
	review: AgentReview,
	repositoryDir: string,
	diff: string,
	run: ReviewRunState,
): Promise<void> => {
	const verifier = createVerifierAgent(reviewer);
	const log = createLogger({ agentId: verifier.id });

	if (!getAgentConfig(verifier).enabled) {
		log.debug("Skipping disabled verifier agent");
		return;
	}

	if (review.findings.length === 0) {
		log.info("Skipping verification, no findings to verify");
		return;
	}

	const editFindingTool = createEditReviewFindingTool(
		repositoryDir,
		review.findings,
	);

	const scopedDiff = selectDiffFiles(diff, findingFilePaths(review.findings));

	const response = await runGuardedSession({
		agent: verifier,
		runtime: context.runtime,
		config: getAgentConfig(verifier),
		customTools: [editFindingTool],
		output: review,
		prompt: formatVerificationPrompt(
			verifier,
			reviewer,
			review.findings,
			scopedDiff,
		),
	});

	run.telemetry.record(verifier.id, response.durationMs, response.usage);

	for (const outcome of response.guardrails.filter(
		(guardrail) => guardrail.terminated,
	)) {
		run.errors.push(
			toGuardrailError(
				nextId(run.errors, `${verifier.id}:error`),
				verifier.id,
				outcome,
			),
		);
	}
};
