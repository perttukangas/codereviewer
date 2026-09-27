import type { Guardrail, GuardrailContext } from "./types.js";

export const createTokenBudgetGuardrail = (
	ctx: GuardrailContext,
): Guardrail => {
	let inputTokens = 0;
	let outputTokens = 0;

	return {
		onUsage: (input, output) => {
			inputTokens += input;
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
