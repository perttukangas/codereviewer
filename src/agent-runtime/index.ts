import {
	createAgentSession,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { env, getAgentConfig } from "../utils/env.js";
import type { Agent, AgentSession } from "./types.js";

export const createAgent = async (agent: Agent): Promise<AgentSession> => {
	const config = getAgentConfig(agent);
	const modelRuntime = await ModelRuntime.create({ refreshOnCreate: false });
	modelRuntime.registerProvider(env.MODEL_PROVIDER, {
		name: env.MODEL_PROVIDER,
		api: env.MODEL_API,
		baseUrl: env.MODEL_BASE_URL,
		apiKey: env.MODEL_API_KEY,
	});
	const { session } = await createAgentSession({
		cwd: env.REPO_DIR,
		modelRuntime,
		model: {
			id: config.model.name,
			name: config.model.name,
			samplingParams: config.model.samplingParams,
			contextWindow: config.limits.contextWindow,
			maxTokens: config.limits.maxOutputTokens,
			api: env.MODEL_API,
			provider: env.MODEL_PROVIDER,
			baseUrl: env.MODEL_BASE_URL,
			reasoning: false, // Use sampling params
			input: ["text"],
			cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
		},
		tools: agent.tools,
		sessionManager: SessionManager.inMemory(env.REPO_DIR),
		settingsManager: SettingsManager.inMemory({
			compaction: { enabled: false },
		}),
	});

	return {
		prompt: async (prompt) => {
			await session.prompt(prompt);
			const assistantMessages = session.messages.filter(
				(message) => message.role === "assistant",
			);
			const assistantMessage = assistantMessages.at(-1);

			const usage = session.messages.reduce(
				(summary, message) => {
					if (!("usage" in message) || !message.usage) {
						return summary;
					}

					return {
						inputTokens: summary.inputTokens + message.usage.input,
						outputTokens: summary.outputTokens + message.usage.output,
						cacheReadTokens: summary.cacheReadTokens + message.usage.cacheRead,
						cacheWriteTokens:
							summary.cacheWriteTokens + message.usage.cacheWrite,
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
			const tools = toolCalls.reduce<Record<string, number>>(
				(counts, toolCall) => {
					counts[toolCall.name] = (counts[toolCall.name] ?? 0) + 1;
					return counts;
				},
				{},
			);

			const response = !assistantMessage
				? "Agent completed without a response."
				: typeof assistantMessage.content === "string"
					? assistantMessage.content
					: assistantMessage.content
							.filter((content) => content.type === "text")
							.map((content) => content.text)
							.join("\n");

			return {
				response,
				usage: {
					...usage,
					totalTokens: usage.inputTokens + usage.outputTokens,
					toolCalls: toolCalls.length,
					tools,
				},
			};
		},
		dispose: () => session.dispose(),
	};
};
