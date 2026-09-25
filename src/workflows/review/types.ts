import type { GuardrailDimension } from "../../engine/types.js";

export type ReviewSeverity = "critical" | "high" | "medium" | "low" | "info";

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
};

export type ReviewFinding = {
	id: string;
	title: string;
	severity: ReviewSeverity;
	confidence: number;
	problem: string;
	suggestedChange?: ReviewSuggestedChange;
	suggestedCodeChanges?: ReviewCodeChange[];
	rationale: string;
	invalidReason?: string;
	mergedFrom?: string[];
	mergedFindingIds?: string[];
};

export type ReviewGuardrailError = {
	id: string;
	agentId: string;
	kind: "guardrail";
	dimension: GuardrailDimension;
	limit: number;
	observed: number;
	message: string;
};

export type ReviewFailureError = {
	id: string;
	agentId: string;
	kind: "error";
	message: string;
};

export type ReviewError = ReviewGuardrailError | ReviewFailureError;

export type AgentReview = {
	findings: ReviewFinding[];
	errors: ReviewError[];
};

export type ReviewReport = Record<string, AgentReview>;
