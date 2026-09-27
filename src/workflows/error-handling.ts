import { toUnhandledError } from "../engine/errors.js";
import type { Workflow } from "./types.js";

export const withErrorHandling = <TOutput>(
	workflow: Workflow<TOutput>,
): Workflow<TOutput> => ({
	id: workflow.id,
	run: async (context) => {
		try {
			return await workflow.run(context);
		} catch (cause) {
			toUnhandledError(`${workflow.id}:unhandled`, cause);
			throw cause;
		}
	},
});
