import type { WorkflowContext } from "../../workflows/types.js";

export type Command = {
	id: string;
	run: (context: WorkflowContext) => Promise<void>;
};
