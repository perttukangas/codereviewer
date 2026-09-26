import type { TelemetryCollector } from "../../engine/telemetry.js";
import type { WorkflowGuardrailError } from "../../engine/types.js";

export type ReviewSeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO";

export type ReviewFinding = {
	id: string;
	title: string;
	severity: ReviewSeverity;
	confidence: number;
	problem: string;
	suggestedChange: string;
	relatedFiles: string[];
	codeChangeFilePath?: string;
	codeChangeOldText?: string;
	codeChangeNewText?: string;
	codeChangeStartLine?: number;
	codeChangeEndLine?: number;
	rationale: string;
	invalidReason?: string;
	mergedFrom?: string[];
	mergedFindingIds?: string[];
};

export type ReviewGuardrailError = WorkflowGuardrailError;

export type ReviewError = ReviewGuardrailError;

export type AgentReview = {
	findings: ReviewFinding[];
};

export type ReviewReport = Record<string, AgentReview>;

export type ReviewRunState = {
	errors: ReviewError[];
	telemetry: TelemetryCollector;
};
