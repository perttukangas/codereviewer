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

export type AgentGuardrails = {
	timeoutMs: number;
	inputTokenBudget: number;
	outputTokenBudget: number;
	softLimitRatio: number;
};

export type AgentConfig = {
	model: AgentModel;
	limits: AgentLimits;
	guardrails: AgentGuardrails;
};

export type GuardrailDimension = "timeout" | "input_tokens" | "output_tokens";

export type GuardrailOutcome = {
	dimension: GuardrailDimension;
	limit: number;
	observed: number;
	terminated: boolean;
};

export type AgentResponse<TOutput> = {
	output: TOutput;
	guardrails: GuardrailOutcome[];
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

export interface GuardedAgentSession<TOutput = AgentReview> {
	prompt: (prompt: string) => Promise<AgentResponse<TOutput>>;
	dispose: () => void;
}
