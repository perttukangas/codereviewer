import type { AgentRuntime } from "../runtime/types.js";
import { env } from "../shared/env.js";
import { createSemaphore } from "../shared/semaphore.js";
import { createGuardrails } from "./guardrails.js";
import type { AgentToolDefinition } from "./tools.js";
import type {
	Agent,
	AgentConfig,
	AgentResponse,
	GuardedAgentSession,
} from "./types.js";

type CreateAgentOptions<TOutput> = {
	config: AgentConfig;
	customTools?: AgentToolDefinition[];
	output: TOutput;
};

const sessionSlots = createSemaphore(env.AGENT_MAX_CONCURRENCY);

export const createAgent = async <TOutput>(
	agent: Agent,
	runtime: AgentRuntime,
	options: CreateAgentOptions<TOutput>,
): Promise<GuardedAgentSession<TOutput>> => {
	const { config, customTools = [], output } = options;

	const releaseSlot = await sessionSlots.acquire();
	let slotReleased = false;
	const release = (): void => {
		if (slotReleased) {
			return;
		}
		slotReleased = true;
		releaseSlot();
	};

	let session: Awaited<ReturnType<AgentRuntime["createSession"]>>;
	try {
		session = await runtime.createSession(agent, {
			model: config.model,
			limits: config.limits,
			customTools,
		});
	} catch (cause) {
		release();
		throw cause;
	}

	const guardrails = createGuardrails({
		agentId: agent.id,
		session,
		config: config.guardrails,
	});

	return {
		prompt: async (prompt): Promise<AgentResponse<TOutput>> => {
			guardrails.start();
			const startedAt = Date.now();
			try {
				await session.prompt(prompt);
			} finally {
				guardrails.stop();
			}
			return {
				output,
				guardrails: guardrails.getOutcomes(),
				durationMs: Date.now() - startedAt,
				usage: session.getUsage(),
			};
		},
		dispose: () => {
			guardrails.dispose();
			session.dispose();
			release();
		},
	};
};
