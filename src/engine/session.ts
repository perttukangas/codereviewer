import { info, startTimer, stopTimer } from "../platform/logger.js";
import type { AgentRuntime } from "../runtime/types.js";
import { createAgent } from "./agent.js";
import type { AgentToolDefinition } from "./tools.js";
import type {
	Agent,
	AgentConfig,
	AgentResponse,
	GuardedAgentSession,
} from "./types.js";

export type RunGuardedSessionOptions<TOutput> = {
	agent: Agent;
	runtime: AgentRuntime;
	config: AgentConfig;
	customTools?: AgentToolDefinition[];
	output: TOutput;
	prompt: string;
	timerId?: string;
};

export const runGuardedSession = async <TOutput>(
	options: RunGuardedSessionOptions<TOutput>,
): Promise<AgentResponse<TOutput>> => {
	const {
		agent,
		runtime,
		config,
		customTools,
		output,
		prompt,
		timerId = agent.id,
	} = options;

	let session: GuardedAgentSession<TOutput> | undefined;
	try {
		info("Creating guarded agent session", timerId);
		session = await createAgent<TOutput>(agent, runtime, {
			config,
			customTools,
			output,
		});
		startTimer(timerId, "Starting agent");
		return await session.prompt(prompt);
	} finally {
		session?.dispose();
		stopTimer(timerId, "Completed agent");
	}
};
