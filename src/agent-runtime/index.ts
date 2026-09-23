import {
	createAgentSession,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { env, getAgentConfig } from "../utils/env.js";
import { debug } from "../utils/logger.js";
import { logAgentDiagnostics, logAgentEvent, logAgentResult } from "./debug.js";
import type {
	Agent,
	AgentReview,
	AgentSession,
	AgentToolDefinition,
	ReviewFinding,
} from "./types.js";

export const createAgent = async (
	agent: Agent,
	customTools: AgentToolDefinition[] = [],
	findings: ReviewFinding[] = [],
): Promise<AgentSession> => {
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
		tools: [...agent.tools, ...customTools.map((tool) => tool.name)],
		customTools,
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
		prompt: async (prompt): Promise<AgentReview> => {
			await session.prompt(prompt);
			logAgentResult(agent.id, session);
			return [...findings];
		},
		dispose: () => {
			unsubscribe();
			session.dispose();
		},
	};
};
