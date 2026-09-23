import {
	type ToolDefinition as PiToolDefinition,
	defineTool as piDefineTool,
} from "@earendil-works/pi-coding-agent";

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
	title: string;
	severity: ReviewSeverity;
	confidence: number;
	problem: string;
	suggestedChange?: ReviewSuggestedChange;
	suggestedCodeChanges?: ReviewCodeChange[];
	rationale: string;
};

export type AgentReview = ReviewFinding[];

export interface AgentSession {
	prompt: (prompt: string) => Promise<AgentReview>;
	dispose: () => void;
}

export type AgentToolDefinition = PiToolDefinition;
export const defineTool = (tool: AgentToolDefinition) => piDefineTool(tool);
