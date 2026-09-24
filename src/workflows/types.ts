import type { AgentRuntime } from "../runtime/types.js";

export type WorkflowContext = {
	runtime: AgentRuntime;
};

export type Workflow<TOutput = unknown> = {
	id: string;
	run: (context: WorkflowContext) => Promise<TOutput>;
};
