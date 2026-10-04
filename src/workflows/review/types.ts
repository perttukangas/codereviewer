import type { TelemetryCollector } from "../../engine/telemetry.js";
import type { WorkflowError } from "../../engine/types.js";
import type { ChangeSet } from "../../integrations/types.js";
import type { WorkflowContext } from "../types.js";
import type { reviewAgents } from "./agents/review-agents.js";
import type { ReviewConfidence, ReviewSeverity } from "./shared/scoring.js";

export type ReviewCategory = (typeof reviewAgents)[number]["id"];

export type ReviewFinding = {
	id: string;
	title: string;
	severity: ReviewSeverity;
	confidence: ReviewConfidence;
	problem: string;
	suggestedChange: string;
	relatedFiles: string[];
	categories?: ReviewCategory[];
	codeChangeFilePath?: string;
	codeChangeOldText?: string;
	codeChangeNewText?: string;
	codeChangeStartLine?: number;
	codeChangeEndLine?: number;
	rationale: string;
	invalidReason?: string;
	mergedFrom?: string[];
	mergedFindingIds?: string[];
	codeChangesOverlap?: string[];
	score?: number;
};

export type ReviewCodeChangeFields = Pick<
	ReviewFinding,
	"codeChangeFilePath" | "codeChangeOldText" | "codeChangeNewText"
>;

export type ReviewError = WorkflowError;

export type AgentReview = {
	findings: ReviewFinding[];
};

export type ReviewReport = Record<string, AgentReview>;

export type ReviewRunState = {
	errors: ReviewError[];
	telemetry: TelemetryCollector;
};

export type ReviewSeed = {
	context: WorkflowContext;
	run: ReviewRunState;
	report: ReviewReport;
	startedAt: number;
};

export type ReviewPipelineState = ReviewSeed & {
	changeSet: ChangeSet;
};
