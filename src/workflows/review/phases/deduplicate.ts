import { getAgentConfig } from "../../../engine/agent-config.js";
import { runGuardedSession } from "../../../engine/session.js";
import { env } from "../../../platform/env.js";
import { debug, info } from "../../../platform/logger.js";
import type { WorkflowContext } from "../../types.js";
import { DeduplicatorAgent } from "../agents/deduplicator.js";
import { formatDeduplicationPrompt } from "../prompt.js";
import { createMergeReviewFindingsTool } from "../tools/merge-review-findings.js";
import { nextId } from "../tools/review-finding/index.js";
import type { AgentReview, ReviewReport } from "../types.js";
import { toGuardrailError } from "./errors.js";

export const deduplicate = async (
	context: WorkflowContext,
	report: ReviewReport,
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

	const dedupReview: AgentReview = { findings: [], errors: [] };
	const mergeTool = createMergeReviewFindingsTool(
		env.REPO_DIR,
		report,
		dedupReview,
	);

	const outcomes = await runGuardedSession({
		agent: DeduplicatorAgent,
		runtime: context.runtime,
		config: getAgentConfig(DeduplicatorAgent),
		customTools: [mergeTool],
		output: dedupReview,
		prompt: formatDeduplicationPrompt(DeduplicatorAgent, eligible),
	});

	for (const outcome of outcomes) {
		dedupReview.errors.push(
			toGuardrailError(
				nextId(dedupReview.errors, `${DeduplicatorAgent.id}:error`),
				DeduplicatorAgent.id,
				outcome,
			),
		);
	}

	if (dedupReview.findings.length > 0 || dedupReview.errors.length > 0) {
		report[DeduplicatorAgent.id] = dedupReview;
	}
};
