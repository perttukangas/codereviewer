import type { WorkflowError, WorkflowTelemetry } from "../engine/types.js";
import type { AgentRuntime } from "../runtime/types.js";

export type WorkflowContext = {
	runtime: AgentRuntime;
};

export type WorkflowResult<TOutput = unknown> = {
	output: TOutput;
	errors: WorkflowError[];
	telemetry: WorkflowTelemetry;
};

export type Workflow<TOutput = unknown> = {
	id: string;
	run: (context: WorkflowContext) => Promise<WorkflowResult<TOutput>>;
};
