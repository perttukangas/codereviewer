import type { AgentUsage } from "../runtime/types.js";
import type { AgentTelemetry, WorkflowTelemetry } from "./types.js";

export const emptyUsage = (): AgentUsage => ({
	inputTokens: 0,
	outputTokens: 0,
	cacheReadTokens: 0,
	cacheWriteTokens: 0,
	totalTokens: 0,
	reportedTotalTokens: 0,
	toolCalls: 0,
	tools: {},
});

export const addUsage = (left: AgentUsage, right: AgentUsage): AgentUsage => {
	const tools: Record<string, number> = { ...left.tools };
	for (const [name, count] of Object.entries(right.tools)) {
		tools[name] = (tools[name] ?? 0) + count;
	}

	return {
		inputTokens: left.inputTokens + right.inputTokens,
		outputTokens: left.outputTokens + right.outputTokens,
		cacheReadTokens: left.cacheReadTokens + right.cacheReadTokens,
		cacheWriteTokens: left.cacheWriteTokens + right.cacheWriteTokens,
		totalTokens: left.totalTokens + right.totalTokens,
		reportedTotalTokens: left.reportedTotalTokens + right.reportedTotalTokens,
		toolCalls: left.toolCalls + right.toolCalls,
		tools,
	};
};

export type TelemetryCollector = {
	record: (agentId: string, durationMs: number, usage: AgentUsage) => void;
	build: (durationMs: number) => WorkflowTelemetry;
};

export const createTelemetryCollector = (): TelemetryCollector => {
	const agents = new Map<string, AgentTelemetry>();

	const record = (
		agentId: string,
		durationMs: number,
		usage: AgentUsage,
	): void => {
		const agent = agents.get(agentId) ?? {
			durationMs: 0,
			usage: emptyUsage(),
		};

		agent.durationMs += durationMs;
		agent.usage = addUsage(agent.usage, usage);
		agents.set(agentId, agent);
	};

	const build = (durationMs: number): WorkflowTelemetry => {
		const usage = [...agents.values()].reduce(
			(total, agent) => addUsage(total, agent.usage),
			emptyUsage(),
		);

		return {
			durationMs,
			usage,
			agents: Object.fromEntries(agents),
		};
	};

	return { record, build };
};
