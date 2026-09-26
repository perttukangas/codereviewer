import { getAgentConfig } from "../../../engine/agent-config.js";
import { runGuardedSession } from "../../../engine/session.js";
import { env } from "../../../shared/env.js";
import { debug, info } from "../../../shared/logger.js";
import type { WorkflowContext } from "../../types.js";
import { DeduplicatorAgent } from "../agents/deduplicator.js";
import { toGuardrailError } from "../shared/errors.js";
import { formatDeduplicationPrompt } from "../shared/prompt.js";
import { createMergeReviewFindingsTool } from "../tools/merge-review-findings.js";
import { nextId } from "../tools/review-finding/index.js";
import type { AgentReview, ReviewReport, ReviewRunState } from "../types.js";

export const deduplicate = async (
	context: WorkflowContext,
	report: ReviewReport,
	run: ReviewRunState,
): Promise<void> => {
	if (!getAgentConfig(DeduplicatorAgent).enabled) {
		debug("Skipping disabled deduplicator agent", DeduplicatorAgent.id);
		return;
	}

	const eligible = Object.values(report)
		.flatMap((review) => review.findings)
		.filter((finding) => finding.invalidReason === undefined);
	if (eligible.length < 2) {
		info(
			"Skipping deduplication, fewer than two eligible findings",
			DeduplicatorAgent.id,
		);
		return;
	}

	const dedupReview: AgentReview = { findings: [] };
	const mergeTool = createMergeReviewFindingsTool(
		env.REPO_DIR,
		report,
		dedupReview,
	);

	const response = await runGuardedSession({
		agent: DeduplicatorAgent,
		runtime: context.runtime,
		config: getAgentConfig(DeduplicatorAgent),
		customTools: [mergeTool],
		output: dedupReview,
		prompt: formatDeduplicationPrompt(DeduplicatorAgent, eligible),
	});

	run.telemetry.record(
		DeduplicatorAgent.id,
		response.durationMs,
		response.usage,
	);

	for (const outcome of response.guardrails.filter(
		(guardrail) => guardrail.terminated,
	)) {
		run.errors.push(
			toGuardrailError(
				nextId(run.errors, `${DeduplicatorAgent.id}:error`),
				DeduplicatorAgent.id,
				outcome,
			),
		);
	}

	if (dedupReview.findings.length > 0) {
		report[DeduplicatorAgent.id] = dedupReview;
	}
};
