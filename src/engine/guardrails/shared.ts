import type { GuardrailDimension } from "../types.js";

export const describeDimension = (dimension: GuardrailDimension): string => {
	switch (dimension) {
		case "timeout":
			return "wall clock timeout";
		case "input_tokens":
			return "input token budget";
		case "output_tokens":
			return "output token budget";
		case "tool_loop":
			return "repeated tool call limit";
		case "tool_failure":
			return "consecutive tool failure limit";
	}
};

export const describeUnit = (dimension: GuardrailDimension): string => {
	switch (dimension) {
		case "timeout":
			return "ms";
		case "input_tokens":
		case "output_tokens":
			return "tokens";
		case "tool_loop":
		case "tool_failure":
			return "calls";
	}
};

export const softWarningMessage = (
	dimension: GuardrailDimension,
	limit: number,
	observed: number,
	toolName?: string,
): string => {
	if (dimension === "tool_loop" || dimension === "tool_failure") {
		const tool = toolName ? `"${toolName}"` : "the same tool";
		const reason =
			dimension === "tool_loop"
				? `You have called ${tool} with identical arguments ${observed} times in a row without making progress.`
				: `You have called ${tool} and it has failed ${observed} times in a row.`;

		return [
			reason,
			"Stop repeating this call.",
			"Rethink how you are using the tool. Change your arguments, use a different tool, or take a different approach.",
		].join(" ");
	}

	const observedText =
		dimension === "timeout"
			? `${Math.round(observed)} ms`
			: `${observed} tokens`;
	const limitText = dimension === "timeout" ? `${limit} ms` : `${limit} tokens`;

	return [
		`You are approaching the ${describeDimension(dimension)} (${observedText} of ${limitText}).`,
		"Stop investigating now and finish the task using the data already collected.",
	].join(" ");
};

export const stableStringify = (value: unknown): string => {
	if (value === null || typeof value !== "object") {
		return JSON.stringify(value) ?? "undefined";
	}
	if (Array.isArray(value)) {
		return `[${value.map(stableStringify).join(",")}]`;
	}
	const entries = Object.entries(value as Record<string, unknown>)
		.filter(([, entryValue]) => entryValue !== undefined)
		.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
	return `{${entries
		.map(
			([key, entryValue]) =>
				`${JSON.stringify(key)}:${stableStringify(entryValue)}`,
		)
		.join(",")}}`;
};
