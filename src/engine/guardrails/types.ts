import type { RuntimeSession } from "../../runtime/types.js";
import type {
	AgentGuardrails,
	GuardrailDimension,
	GuardrailOutcome,
} from "../types.js";

export type GuardrailsOptions = {
	agentId: string;
	session: RuntimeSession;
	config: AgentGuardrails;
	onOutcome?: (outcome: GuardrailOutcome) => void;
};

export type AgentGuardrailsHandle = {
	start: () => void;
	stop: () => void;
	dispose: () => void;
	getOutcomes: () => GuardrailOutcome[];
	isTerminated: () => boolean;
};

export type GuardrailContext = {
	config: AgentGuardrails;
	checkBudget: (
		dimension: GuardrailDimension,
		budget: number,
		observed: number,
		toolName?: string,
	) => void;
	warn: (
		dimension: GuardrailDimension,
		limit: number,
		observed: number,
		toolName?: string,
	) => void;
	interrupt: (message: string) => void;
	terminate: (
		dimension: GuardrailDimension,
		limit: number,
		observed: number,
		toolName?: string,
	) => void;
	isTerminated: () => boolean;
};

export type Guardrail = {
	start?: () => void;
	stop?: () => void;
	onToolStart?: (toolName: string, args: unknown) => void;
	onToolEnd?: (toolName: string, isError: boolean) => void;
	onUsage?: (
		inputTokens: number,
		outputTokens: number,
		cacheReadTokens: number,
	) => void;
};
