import type {
	AgentSessionEvent,
	AgentSession as PiAgentSession,
} from "@earendil-works/pi-coding-agent";

import { debug } from "../utils/logger.js";

type AssistantMessage = Extract<
	Extract<AgentSessionEvent, { type: "message_end" }>["message"],
	{ role: "assistant" }
>;

export type AgentUsage = {
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
	totalTokens: number;
	reportedTotalTokens: number;
	toolCalls: number;
	tools: Record<string, number>;
};

export type AgentDiagnostics = {
	systemPrompt: string;
	tools: string[];
};

export const logAgentEvent = (
	agentId: string,
	event: AgentSessionEvent,
	turnNumber: number,
): number => {
	if (event.type === "message_update" && event.message.role === "assistant") {
		return turnNumber;
	}
	if (event.type === "message_end" && event.message.role === "assistant") {
		debug(
			"Agent completed message",
			agentId,
			describeAssistantMessage(event.message),
		);
		return turnNumber;
	}

	if (event.type === "turn_start") {
		turnNumber += 1;
	}
	debug(
		"Agent event",
		agentId,
		event.type,
		describeAgentEvent(event, turnNumber),
	);
	return turnNumber;
};

const describeAssistantMessage = (
	message: AssistantMessage,
): Record<string, unknown> => ({
	content: message.content.map((block) => {
		switch (block.type) {
			case "text":
				return { type: block.type, text: block.text };
			case "thinking":
				return {
					type: block.type,
					thinking: block.thinking,
					...(block.redacted === undefined ? {} : { redacted: block.redacted }),
				};
			case "toolCall":
				return {
					type: block.type,
					name: block.name,
					arguments: block.arguments,
				};
			default:
				throw new Error("Unsupported assistant content block");
		}
	}),
});

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

export const logAgentResult = (
	agentId: string,
	session: PiAgentSession,
): void => {
	debug("Agent usage", agentId, collectAgentUsage(session));
};

export const logAgentDiagnostics = (
	agentId: string,
	diagnostics: AgentDiagnostics,
): void => {
	debug("Agent diagnostics", agentId, diagnostics);
};

const describeAgentEvent = (
	event: AgentSessionEvent,
	turnNumber: number,
): Record<string, unknown> => {
	switch (event.type) {
		case "turn_start":
		case "turn_end":
			return {
				turn: turnNumber,
				...(event.type === "turn_end"
					? { toolResults: event.toolResults.length }
					: {}),
			};
		case "message_start":
		case "message_end":
		case "message_update":
			return {
				role: event.message.role,
				...(event.message.role === "assistant" && event.message.errorMessage
					? { error: event.message.errorMessage }
					: {}),
			};
		case "tool_execution_start":
		case "tool_execution_update":
		case "tool_execution_end":
			return {
				tool: event.toolName,
				...(event.type === "tool_execution_end"
					? {
							isError: event.isError,
							result: summarizeToolResult(event.result),
						}
					: {}),
			};
		case "agent_start":
		case "agent_settled":
		case "compaction_end":
		case "summarization_retry_finished":
			return {};
		case "agent_end": {
			const lastMessage = event.messages.at(-1);
			return {
				messages: event.messages.length,
				willRetry: event.willRetry,
				...(lastMessage?.role === "assistant" && lastMessage.errorMessage
					? { error: lastMessage.errorMessage }
					: {}),
			};
		}
		case "queue_update":
			return {
				steering: event.steering.length,
				followUp: event.followUp.length,
			};
		case "compaction_start":
			return { reason: event.reason };
		case "entry_appended":
			return { entryType: event.entry.type };
		case "session_info_changed":
			return { name: event.name };
		case "thinking_level_changed":
			return { level: event.level };
		case "auto_retry_start":
			return {
				attempt: event.attempt,
				maxAttempts: event.maxAttempts,
				error: event.errorMessage,
			};
		case "auto_retry_end":
			return {
				attempt: event.attempt,
				success: event.success,
				...(event.finalError ? { error: event.finalError } : {}),
			};
		case "summarization_retry_scheduled":
			return {
				attempt: event.attempt,
				maxAttempts: event.maxAttempts,
				error: event.errorMessage,
			};
		case "summarization_retry_attempt_start":
			return { source: event.source };
		case "bash_execution_update":
			return {
				id: event.id,
				deltaLength: event.delta.length,
			};
	}
};

const summarizeToolResult = (result: unknown): string | undefined => {
	if (!result || typeof result !== "object" || !("content" in result)) {
		return undefined;
	}

	const content = result.content;
	if (!Array.isArray(content)) {
		return undefined;
	}

	return content
		.filter(
			(item): item is { type: "text"; text: string } =>
				Boolean(item) &&
				typeof item === "object" &&
				item.type === "text" &&
				typeof item.text === "string",
		)
		.map((item) => item.text)
		.join("\n");
};
