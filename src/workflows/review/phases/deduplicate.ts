import { getAgentConfig } from "../../../engine/agent-config.js";
import { toGuardrailError } from "../../../engine/errors.js";
import { runGuardedSession } from "../../../engine/session.js";
import { env } from "../../../shared/env.js";
import { createLogger } from "../../../shared/logger.js";
import type { Phase } from "../../pipeline.js";
import { DeduplicatorAgent } from "../agents/deduplicator.js";
import { logFindingsSnapshot } from "../shared/findings.js";
import { formatDeduplicationPrompt } from "../shared/prompt.js";
import { createMergeReviewFindingsTool } from "../tools/merge-review-findings.js";
import { nextId } from "../tools/review-finding/index.js";
import type { AgentReview, ReviewPipelineState } from "../types.js";

export const deduplicate: Phase<ReviewPipelineState> = {
	id: "deduplicate",
	run: async (state) => {
		const { context, report, run } = state;
		const log = createLogger({ agentId: DeduplicatorAgent.id });

		if (!getAgentConfig(DeduplicatorAgent).enabled) {
			log.debug("Skipping disabled deduplicator agent");
			return state;
		}

		const eligible = Object.values(report)
			.flatMap((review) => review.findings)
			.filter((finding) => finding.invalidReason === undefined);
		if (eligible.length < 2) {
			log.info("Skipping deduplication, fewer than two eligible findings");
			return state;
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

		logFindingsSnapshot(log, "Deduplicated findings", dedupReview.findings);

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

		return state;
	},
};
