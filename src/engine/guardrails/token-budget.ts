import type { Guardrail, GuardrailContext } from "./types.js";

export const createTokenBudgetGuardrail = (
	ctx: GuardrailContext,
): Guardrail => {
	let inputTokens = 0;
	let outputTokens = 0;

	return {
		onUsage: (input, output, cacheRead) => {
			inputTokens = Math.max(inputTokens, input + cacheRead);
			outputTokens += output;
			ctx.checkBudget("input_tokens", ctx.config.inputTokenBudget, inputTokens);
			ctx.checkBudget(
				"output_tokens",
				ctx.config.outputTokenBudget,
				outputTokens,
			);
		},
	};
};
