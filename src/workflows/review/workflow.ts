import { createTelemetryCollector } from "../../engine/telemetry.js";
import { runPipeline } from "../pipeline.js";
import type { Workflow, WorkflowContext, WorkflowResult } from "../types.js";
import { deduplicate } from "./phases/deduplicate.js";
import { loadChanges } from "./phases/load-changes.js";
import { reviewAgentsPhase } from "./phases/review-agents.js";
import { score } from "./phases/score.js";
import type { ReviewPipelineState, ReviewReport, ReviewSeed } from "./types.js";

const createReviewSeed = (context: WorkflowContext): ReviewSeed => ({
	context,
	run: { errors: [], telemetry: createTelemetryCollector() },
	report: {},
	startedAt: Date.now(),
});

const toResult = (
	state: ReviewPipelineState,
): WorkflowResult<ReviewReport> => ({
	output: state.report,
	errors: state.run.errors,
	telemetry: state.run.telemetry.build(Date.now() - state.startedAt),
});

const phases = [loadChanges, reviewAgentsPhase, deduplicate, score] as const;

const run = async (
	context: WorkflowContext,
): Promise<WorkflowResult<ReviewReport>> =>
	toResult(await runPipeline(createReviewSeed(context), phases));

export const reviewWorkflow: Workflow<ReviewReport> = {
	id: "review",
	run,
};
