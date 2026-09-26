import type { AgentUsage } from "../runtime/types.js";

export type Agent = {
	id: string;
	/**
	 * Base id used to resolve configuration. Defaults to `id`. Set this when an
	 * agent runs under a scoped runtime id (for example `code-quality:verifier`)
	 * but should share the configuration of its base agent (`verifier`).
	 */
	configId?: string;
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

export type WorkflowGuardrailError = {
	id: string;
	agentId: string;
	kind: "guardrail";
	dimension: GuardrailDimension;
	limit: number;
	observed: number;
	message: string;
};

export type WorkflowFailureError = {
	id: string;
	agentId: string;
	kind: "error";
	message: string;
};

export type WorkflowError = WorkflowGuardrailError | WorkflowFailureError;

export type AgentTelemetry = {
	durationMs: number;
	usage: AgentUsage;
};

export type WorkflowTelemetry = {
	durationMs: number;
	usage: AgentUsage;
	agents: Record<string, AgentTelemetry>;
};

export type AgentResponse<TOutput> = {
	output: TOutput;
	guardrails: GuardrailOutcome[];
	durationMs: number;
	usage: AgentUsage;
};

export interface GuardedAgentSession<TOutput> {
	prompt: (prompt: string) => Promise<AgentResponse<TOutput>>;
	dispose: () => void;
}
