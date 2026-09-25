import type { AgentSession as PiAgentSession } from "@earendil-works/pi-coding-agent";
import type { AgentUsage } from "../../types.js";

export const collectAgentUsage = (session: PiAgentSession): AgentUsage => {
	const assistantMessages = session.messages.filter(
		(message) => message.role === "assistant",
	);

	const usage = session.messages.reduce(
		(summary, message) => {
			if (!("usage" in message) || !message.usage) {
				return summary;
			}

			return {
				inputTokens: summary.inputTokens + message.usage.input,
				outputTokens: summary.outputTokens + message.usage.output,
				cacheReadTokens: summary.cacheReadTokens + message.usage.cacheRead,
				cacheWriteTokens: summary.cacheWriteTokens + message.usage.cacheWrite,
				reportedTotalTokens:
					summary.reportedTotalTokens + message.usage.totalTokens,
			};
		},
		{
			inputTokens: 0,
			outputTokens: 0,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
			reportedTotalTokens: 0,
		},
	);

	const toolCalls = assistantMessages.flatMap((message) =>
		message.content.filter((content) => content.type === "toolCall"),
	);

	const tools = toolCalls.reduce<Record<string, number>>((counts, toolCall) => {
		counts[toolCall.name] = (counts[toolCall.name] ?? 0) + 1;
		return counts;
	}, {});

	return {
		...usage,
		totalTokens: usage.inputTokens + usage.outputTokens,
		toolCalls: toolCalls.length,
		tools,
	};
};
