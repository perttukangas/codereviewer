import type { ToolDefinition } from "@earendil-works/pi-coding-agent";

export type Agent = {
	id: string;
	tools: ("read" | "grep" | "find" | "ls" | "submit_review_finding")[];
	role: string;
	scope?: string[];
	constraints?: string[];
};

export type AgentModel = {
	name: string;
	samplingParams: Record<string, unknown>;
};

export type AgentLimits = {
	contextWindow: number;
	maxOutputTokens: number;
};

export type ReviewSeverity = "critical" | "high" | "medium" | "low" | "info";

export type ReviewLocation = {
	path: string;
	startLine: number;
	endLine?: number;
};

export type ReviewFinding = {
	title: string;
	severity: ReviewSeverity;
	confidence: number;
	locations: ReviewLocation[];
	problem: string;
	suggestedChange: string;
	rationale: string;
};

export type AgentReview = ReviewFinding[];

export interface AgentSession {
	prompt: (prompt: string) => Promise<AgentReview>;
	dispose: () => void;
}

export type AgentToolDefinition = ToolDefinition;
