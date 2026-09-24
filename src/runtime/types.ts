import type { AgentToolDefinition } from "../engine/tools.js";
import type { Agent, AgentLimits, AgentModel } from "../engine/types.js";

export type AgentUsage = {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	totalTokens: number;
};

export type AgentRuntimeEvent =
	| { type: "agent_start" }
	| { type: "agent_end" }
	| { type: "turn_start" }
	| { type: "turn_end" }
	| { type: "message_end"; role: string; usage?: AgentUsage }
	| { type: "tool_execution_start"; toolName: string }
	| { type: "tool_execution_end"; toolName: string; isError: boolean };

export type AgentRuntimeEventListener = (event: AgentRuntimeEvent) => void;

export type RuntimeSession = {
	prompt: (prompt: string) => Promise<void>;
	subscribe: (listener: AgentRuntimeEventListener) => () => void;
	steer: (message: string) => Promise<void>;
	abort: () => Promise<void>;
	clearQueue: () => void;
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
