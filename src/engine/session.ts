import type { AgentRuntime } from "../runtime/types.js";
import { createLogger } from "../shared/logger.js";
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
};

export const runGuardedSession = async <TOutput>(
	options: RunGuardedSessionOptions<TOutput>,
): Promise<AgentResponse<TOutput>> => {
	const { agent, runtime, config, customTools, output, prompt } = options;
	const log = createLogger({ agentId: agent.id });

	let session: GuardedAgentSession<TOutput> | undefined;
	try {
		log.info("Creating guarded agent session");
		session = await createAgent<TOutput>(agent, runtime, {
			config,
			customTools,
			output,
		});
		log.startTimer(agent.id, "Starting agent");
		return await session.prompt(prompt);
	} finally {
		session?.dispose();
		log.stopTimer(agent.id, "Completed agent");
	}
};
