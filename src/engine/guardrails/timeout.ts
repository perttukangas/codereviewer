import type { Guardrail, GuardrailContext } from "./types.js";

export const createTimeoutGuardrail = (ctx: GuardrailContext): Guardrail => {
	let startedAt = 0;
	let softTimer: NodeJS.Timeout | undefined;
	let hardTimer: NodeJS.Timeout | undefined;

	const clearTimers = (): void => {
		if (softTimer) {
			clearTimeout(softTimer);
			softTimer = undefined;
		}
		if (hardTimer) {
			clearTimeout(hardTimer);
			hardTimer = undefined;
		}
	};

	const start = (): void => {
		const { timeoutMs, softLimitRatio } = ctx.config;
		if (timeoutMs <= 0) {
			return;
		}

		startedAt = Date.now();
		const elapsed = (): number => Date.now() - startedAt;
		const softLimitMs = timeoutMs * softLimitRatio;

		if (softLimitMs > 0 && softLimitMs < timeoutMs) {
			softTimer = setTimeout(() => {
				if (ctx.isTerminated()) {
					return;
				}
				const observed = elapsed();
				if (observed >= timeoutMs) {
					return;
				}
				ctx.warn("timeout", timeoutMs, observed);
			}, softLimitMs);
		}

		hardTimer = setTimeout(() => {
			if (ctx.isTerminated()) {
				return;
			}
			ctx.terminate("timeout", timeoutMs, elapsed());
		}, timeoutMs);
	};

	return {
		start,
		stop: clearTimers,
	};
};
