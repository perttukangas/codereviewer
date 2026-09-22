export type Agent = {
	id: string;
	tools: ("read" | "grep" | "find" | "ls")[];
	prompt: string;
};

export type AgentModel = {
	name: string;
	samplingParams: Record<string, unknown>;
};

export type AgentLimits = {
	contextWindow: number;
	maxOutputTokens: number;
};

export type AgentUsage = {
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
	totalTokens: number;
	reportedTotalTokens: number;
	toolCalls: number;
	tools: Record<string, number>;
};

export type AgentReview = {
	response: string;
	usage: AgentUsage;
};

export interface AgentSession {
	prompt: (prompt: string) => Promise<AgentReview>;
	dispose: () => void;
}
