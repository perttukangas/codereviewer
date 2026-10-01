import type { WorkflowContext } from "../../workflows/types.js";

export type CommandOptions = {
	output?: string;
};

export type Command = {
	id: string;
	run: (context: WorkflowContext, options: CommandOptions) => Promise<void>;
};
