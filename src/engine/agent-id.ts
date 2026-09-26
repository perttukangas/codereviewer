import type { Agent } from "./types.js";

export const deriveAgent = (agent: Agent, id: string): Agent => ({
	...agent,
	id,
	configId: agent.configId ?? agent.id,
});
