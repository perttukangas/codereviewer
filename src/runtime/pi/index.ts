import {
	type AgentSessionEvent,
	createAgentSession,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { env } from "../../platform/env.js";
import type {
	AgentRuntime,
	AgentRuntimeEvent,
	AgentRuntimeEventListener,
	CreateSessionOptions,
	RuntimeSession,
} from "../types.js";
import {
	logAgentDiagnostics,
	logAgentEvent,
	logAgentResult,
} from "./events.js";
import { toPiTool } from "./tools.js";

const toRuntimeEvent = (
	event: AgentSessionEvent,
): AgentRuntimeEvent | undefined => {
	switch (event.type) {
		case "agent_start":
			return { type: "agent_start" };
		case "agent_end":
			return { type: "agent_end" };
		case "turn_start":
			return { type: "turn_start" };
		case "turn_end":
			return { type: "turn_end" };
		case "message_end": {
			const usage = "usage" in event.message ? event.message.usage : undefined;
			return {
				type: "message_end",
				role: event.message.role,
				...(usage
					? {
							usage: {
								input: usage.input,
								output: usage.output,
								cacheRead: usage.cacheRead,
								cacheWrite: usage.cacheWrite,
								totalTokens: usage.totalTokens,
							},
						}
					: {}),
			};
		}
		case "tool_execution_start":
			return { type: "tool_execution_start", toolName: event.toolName };
		case "tool_execution_end":
			return {
				type: "tool_execution_end",
				toolName: event.toolName,
				isError: event.isError,
			};
		default:
			return undefined;
	}
};

export const createPiRuntime = (): AgentRuntime => ({
	createSession: async (
		agent,
		options: CreateSessionOptions,
	): Promise<RuntimeSession> => {
		const { model, limits, customTools = [] } = options;

		const modelRuntime = await ModelRuntime.create({ refreshOnCreate: false });
		modelRuntime.registerProvider(env.MODEL_PROVIDER, {
			name: env.MODEL_PROVIDER,
			api: env.MODEL_API,
			baseUrl: env.MODEL_BASE_URL,
			apiKey: env.MODEL_API_KEY,
		});

		const piTools = customTools.map(toPiTool);

		const { session } = await createAgentSession({
			cwd: env.REPO_DIR,
			modelRuntime,
			model: {
				id: model.name,
				name: model.name,
				samplingParams: model.samplingParams,
				contextWindow: limits.contextWindow,
				maxTokens: limits.maxOutputTokens,
				api: env.MODEL_API,
				provider: env.MODEL_PROVIDER,
				baseUrl: env.MODEL_BASE_URL,
				reasoning: false, // Use sampling params
				input: ["text"],
				cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
			},
			tools: [...agent.tools, ...customTools.map((tool) => tool.name)],
			customTools: piTools,
			sessionManager: SessionManager.inMemory(env.REPO_DIR),
			settingsManager: SettingsManager.inMemory({
				compaction: { enabled: false },
				enableInstallTelemetry: false,
				enableAnalytics: false,
			}),
		});

		logAgentDiagnostics(agent.id, {
			systemPrompt: session.agent.state.systemPrompt,
			tools: session.agent.state.tools.map((tool) => tool.name),
		});

		let turnNumber = 0;
		const unsubscribe = session.subscribe((event) => {
			turnNumber = logAgentEvent(agent.id, event, turnNumber);
		});

		return {
			prompt: async (prompt): Promise<void> => {
				await session.prompt(prompt);
				logAgentResult(agent.id, session);
			},
			subscribe: (listener: AgentRuntimeEventListener): (() => void) => {
				return session.subscribe((event) => {
					const runtimeEvent = toRuntimeEvent(event);
					if (runtimeEvent) {
						listener(runtimeEvent);
					}
				});
			},
			steer: (message: string): Promise<void> => session.steer(message),
			abort: (): Promise<void> => session.abort(),
			clearQueue: (): void => {
				session.clearQueue();
			},
			get isStreaming(): boolean {
				return session.isStreaming;
			},
			dispose: (): void => {
				unsubscribe();
				session.dispose();
			},
		};
	},
});
