import { getAgentConfig } from "../../engine/agent-config.js";
import { createTelemetryCollector } from "../../engine/telemetry.js";
import type { Agent } from "../../engine/types.js";
import { createLocalGitChangeSource } from "../../integrations/local-git.js";
import type { ChangeSource } from "../../integrations/types.js";
import { debug, info } from "../../platform/logger.js";
import type { Workflow, WorkflowContext, WorkflowResult } from "../types.js";
import { reviewAgents } from "./agents/index.js";
import { VerifierAgent } from "./agents/verifier.js";
import { getReviewEnv } from "./env.js";
import { deduplicate } from "./phases/deduplicate.js";
import { toReviewError } from "./phases/errors.js";
import { reviewAgent } from "./phases/review-agent.js";
import { validateReviewInputs } from "./phases/validate-inputs.js";
import { verifyReview } from "./phases/verify-review.js";
import { nextId, severityValues } from "./tools/review-finding/index.js";
import type { AgentReview, ReviewReport, ReviewRunState } from "./types.js";

export { validateReviewInputs } from "./phases/validate-inputs.js";

export const run = async (
	context: WorkflowContext,
): Promise<WorkflowResult<ReviewReport>> => {
	const startedAt = Date.now();
	await validateReviewInputs();

	const { GIT_DIFF_PATH } = getReviewEnv();
	const changeSource: ChangeSource = createLocalGitChangeSource(GIT_DIFF_PATH);

	info("Reading Git diff", GIT_DIFF_PATH);
	const changeSet = await changeSource.load();

	const runState: ReviewRunState = {
		errors: [],
		telemetry: createTelemetryCollector(),
	};

	const enabledAgents = reviewAgents.filter((agent) => {
		if (getAgentConfig(agent).enabled) {
			return true;
		}
		debug("Skipping disabled review agent", agent.id);
		return false;
	});

	const results = await Promise.all(
		enabledAgents.map((agent) =>
			runAgentPipeline(
				context,
				agent,
				changeSet.repositoryDir,
				changeSet.diff,
				runState,
			),
		),
	);

	const report: ReviewReport = Object.fromEntries(results);
	await deduplicate(context, report, runState);

	return {
		output: report,
		errors: runState.errors,
		telemetry: runState.telemetry.build(Date.now() - startedAt),
	};
};

const runAgentPipeline = async (
	context: WorkflowContext,
	agent: Agent,
	repositoryDir: string,
	diff: string,
	runState: ReviewRunState,
): Promise<[string, AgentReview]> => {
	const review: AgentReview = { findings: [] };

	try {
		await reviewAgent(context, agent, repositoryDir, diff, review, runState);
		if (getAgentConfig(VerifierAgent).enabled) {
			await verifyReview(context, agent, review, repositoryDir, diff, runState);
		} else {
			debug("Skipping disabled verifier agent", VerifierAgent.id);
		}
	} catch (cause) {
		runState.errors.push(
			toReviewError(nextId(runState.errors, `${agent.id}:error`), agent, cause),
		);
	}

	info(
		`Agent reported ${review.findings.length} findings`,
		agent.id,
		severityValues
			.map(
				(severity) =>
					`${severity}=${review.findings.filter((finding) => finding.severity === severity).length}`,
			)
			.join(", "),
	);

	return [agent.id, review];
};

export const reviewWorkflow: Workflow<ReviewReport> = {
	id: "review",
	run,
};
