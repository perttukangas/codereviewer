export type Agent = {
	id: string;
	tools: string[];
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
	enabled: boolean;
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

export interface GuardedAgentSession<TOutput> {
	prompt: (prompt: string) => Promise<AgentResponse<TOutput>>;
	dispose: () => void;
}
