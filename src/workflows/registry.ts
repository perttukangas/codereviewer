import { reviewWorkflow } from "./review/workflow.js";
import type { Workflow } from "./types.js";

const workflows = new Map<string, Workflow>();

const register = (workflow: Workflow): void => {
	workflows.set(workflow.id, workflow);
};

register(reviewWorkflow);

export const getWorkflow = (id: string): Workflow => {
	const workflow = workflows.get(id);
	if (!workflow) {
		throw new Error(
			`Unknown workflow: ${id}. Available workflows: ${[...workflows.keys()].join(", ")}`,
		);
	}
	return workflow;
};

export const listWorkflows = (): string[] => [...workflows.keys()];
