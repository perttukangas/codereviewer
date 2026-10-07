import { getAgentConfig } from "../../../engine/agent-config.js";
import {
	toGuardrailError,
	toGuardrailWarning,
} from "../../../engine/errors.js";
import { runGuardedSession } from "../../../engine/session.js";
import { completionTool } from "../../../engine/tools/index.js";
import { env } from "../../../shared/env.js";
import { createLogger } from "../../../shared/logger.js";
import type { Phase } from "../../pipeline.js";
import { DeduplicatorAgent } from "../agents/deduplicator.js";
import {
	allFindings,
	flagCodeChangeOverlaps,
	logFindingsSnapshot,
} from "../shared/findings.js";
import { formatDeduplicationPrompt } from "../shared/prompt.js";
import { createMergeReviewFindingsTool } from "../tools/merge-review-findings.js";
import { nextId } from "../tools/review-finding/index.js";
import type { AgentReview, ReviewPipelineState } from "../types.js";

export const deduplicate: Phase<ReviewPipelineState> = {
	id: "deduplicate",
	run: async (state) => {
		await runDeduplication(state);

		const log = createLogger();
		const flagged = flagCodeChangeOverlaps(state.report);
		if (flagged.length > 0) {
			log.info(
				`Flagged ${flagged.length} findings with overlapping code changes`,
			);
			for (const finding of flagged) {
				log.info(
					`- ${finding.id} overlaps ${finding.codeChangesOverlap?.join(", ")}`,
				);
			}
		}

		return state;
	},
};

const runDeduplication = async (state: ReviewPipelineState): Promise<void> => {
	const { context, report, run } = state;
	const log = createLogger({ agentId: DeduplicatorAgent.id });

	if (!getAgentConfig(DeduplicatorAgent).enabled) {
		log.debug("Skipping disabled deduplicator agent");
		return;
	}

	const eligible = allFindings(report).filter(
		(finding) => finding.invalidReason === undefined,
	);
	if (eligible.length < 2) {
		log.info("Skipping deduplication, fewer than two eligible findings");
		return;
	}

	const dedupReview: AgentReview = { findings: [] };
	const mergeTool = createMergeReviewFindingsTool(
		env.REPO_DIR,
		report,
		dedupReview,
	);

	const config = getAgentConfig(DeduplicatorAgent);
	const response = await runGuardedSession({
		agent: DeduplicatorAgent,
		runtime: context.runtime,
		config,
		customTools: [mergeTool, completionTool],
		output: dedupReview,
		prompt: formatDeduplicationPrompt(DeduplicatorAgent, eligible),
	});

	run.telemetry.record(
		DeduplicatorAgent.id,
		response.durationMs,
		response.usage,
		config.model.name,
		response.completion.continuations,
	);

	logFindingsSnapshot(log, "Deduplicated findings", dedupReview.findings);

	for (const outcome of response.guardrails) {
		const errorId = nextId(run.errors, `${DeduplicatorAgent.id}:error`);
		run.errors.push(
			outcome.terminated
				? toGuardrailError(errorId, DeduplicatorAgent.id, outcome)
				: toGuardrailWarning(errorId, DeduplicatorAgent.id, outcome),
		);
	}

	if (dedupReview.findings.length > 0) {
		report[DeduplicatorAgent.id] = dedupReview;
	}
};
