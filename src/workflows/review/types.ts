import type { TelemetryCollector } from "../../engine/telemetry.js";
import type {
	WorkflowFailureError,
	WorkflowGuardrailError,
} from "../../engine/types.js";

export type ReviewSeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO";

export type ReviewCodeChange = {
	filePath: string;
	oldText: string;
	newText: string;
	startLine: number;
	endLine: number;
};

export type ReviewSuggestedChange = {
	filePaths: string[];
	explanation: string;
	codeChange?: ReviewCodeChange;
};

export type ReviewFinding = {
	id: string;
	title: string;
	severity: ReviewSeverity;
	confidence: number;
	problem: string;
	suggestedChange: ReviewSuggestedChange;
	rationale: string;
	invalidReason?: string;
	mergedFrom?: string[];
	mergedFindingIds?: string[];
};

export type ReviewGuardrailError = WorkflowGuardrailError;

export type ReviewFailureError = WorkflowFailureError;

export type ReviewError = ReviewGuardrailError | ReviewFailureError;

export type AgentReview = {
	findings: ReviewFinding[];
};

export type ReviewReport = Record<string, AgentReview>;

export type ReviewRunState = {
	errors: ReviewError[];
	telemetry: TelemetryCollector;
};
