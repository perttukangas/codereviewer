import type { Guardrail, GuardrailContext } from "./types.js";

export const createToolFailureGuardrail = (
	ctx: GuardrailContext,
): Guardrail => {
	let lastFailedTool: string | undefined;
	let failureCount = 0;

	return {
		onToolEnd: (toolName, isError) => {
			if (!isError) {
				lastFailedTool = undefined;
				failureCount = 0;
				return;
			}
			if (toolName === lastFailedTool) {
				failureCount += 1;
			} else {
				lastFailedTool = toolName;
				failureCount = 1;
			}
			ctx.checkBudget(
				"tool_failure",
				ctx.config.toolFailureThreshold,
				failureCount,
				toolName,
			);
		},
	};
};
