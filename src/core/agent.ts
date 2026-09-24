import type { AgentRuntime } from "../runtime/types.js";
import { createGuardrails } from "./guardrails.js";
import type { AgentToolDefinition } from "./tools.js";
import type {
	Agent,
	AgentConfig,
	AgentResponse,
	AgentReview,
	GuardedAgentSession,
	ReviewFinding,
} from "./types.js";

type CreateAgentOptions<TOutput> = {
	config: AgentConfig;
	customTools?: AgentToolDefinition[];
	output?: TOutput;
	onGuardrailFinding?: (finding: ReviewFinding) => void;
};

export const createAgent = async <TOutput = AgentReview>(
	agent: Agent,
	runtime: AgentRuntime,
	options: CreateAgentOptions<TOutput>,
): Promise<GuardedAgentSession<TOutput>> => {
	const {
		config,
		customTools = [],
		output = [] as unknown as TOutput,
		onGuardrailFinding,
	} = options;

	const session = await runtime.createSession(agent, {
		model: config.model,
		limits: config.limits,
		customTools,
	});

	const guardrails = createGuardrails({
		agentId: agent.id,
		session,
		config: config.guardrails,
		onFinding: agent.tools.includes("submit_review_finding")
			? onGuardrailFinding
			: undefined,
	});

	return {
		prompt: async (prompt): Promise<AgentResponse<TOutput>> => {
			guardrails.start();
			try {
				await session.prompt(prompt);
			} finally {
				guardrails.stop();
			}
			return {
				output,
				guardrails: guardrails.getOutcomes(),
			};
		},
		dispose: () => {
			guardrails.dispose();
			session.dispose();
		},
	};
};
