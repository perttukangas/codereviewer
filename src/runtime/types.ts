import type { AgentToolDefinition } from "../engine/tools.js";
import type { Agent, AgentLimits, AgentModel } from "../engine/types.js";

export type MessageUsage = {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	totalTokens: number;
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

export type AgentRuntimeEvent =
	| { type: "agent_start" }
	| { type: "agent_end" }
	| { type: "turn_start" }
	| { type: "turn_end" }
	| { type: "message_end"; role: string; usage?: MessageUsage }
	| { type: "tool_execution_start"; toolName: string }
	| { type: "tool_execution_end"; toolName: string; isError: boolean };

export type AgentRuntimeEventListener = (event: AgentRuntimeEvent) => void;

export type RuntimeSession = {
	prompt: (prompt: string) => Promise<void>;
	subscribe: (listener: AgentRuntimeEventListener) => () => void;
	steer: (message: string) => Promise<void>;
	abort: () => Promise<void>;
	clearQueue: () => void;
	getUsage: () => AgentUsage;
	readonly isStreaming: boolean;
	dispose: () => void;
};

export type CreateSessionOptions = {
	model: AgentModel;
	limits: AgentLimits;
	customTools?: AgentToolDefinition[];
};

export interface AgentRuntime {
	createSession: (
		agent: Agent,
		options: CreateSessionOptions,
	) => Promise<RuntimeSession>;
}
