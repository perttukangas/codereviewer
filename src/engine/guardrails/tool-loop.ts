import { stableStringify } from "./shared.js";
import type { Guardrail, GuardrailContext } from "./types.js";

export const createToolLoopGuardrail = (ctx: GuardrailContext): Guardrail => {
	let lastSignature: string | undefined;
	let identicalCount = 0;

	return {
		onToolStart: (toolName, args) => {
			const signature = `${toolName}:${stableStringify(args)}`;
			if (signature === lastSignature) {
				identicalCount += 1;
			} else {
				lastSignature = signature;
				identicalCount = 1;
			}
			ctx.checkBudget(
				"tool_loop",
				ctx.config.toolLoopThreshold,
				identicalCount,
				toolName,
			);
		},
	};
};
