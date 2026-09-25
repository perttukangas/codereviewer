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
	id: number;
	title: string;
	severity: ReviewSeverity;
	confidence: number;
	problem: string;
	suggestedChange?: ReviewSuggestedChange;
	suggestedCodeChanges?: ReviewCodeChange[];
	rationale: string;
	invalidReason?: string;
};

export type AgentReview = ReviewFinding[];

export type ReviewReport = Record<string, AgentReview>;
