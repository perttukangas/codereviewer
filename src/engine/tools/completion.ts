import { Type } from "typebox";
import type { RuntimeSession } from "../../runtime/types.js";
import type { ScopedLogger } from "../../shared/logger.js";
import type { AgentToolDefinition } from "./definition.js";
import { defineTool, toolResult } from "./definition.js";

const completionNudge = [
	"You stopped without calling the complete_task tool, so the task is not complete.",
	"If you are finished, call the tool now.",
	"If you are not finished, continue the task and call the tool when you are done.",
	"Emit tool calls through the tool mechanism only. Do not write a tool call as text or thinking, and do not describe a call you did not make.",
].join(" ");

export const completionTool = defineTool({
	name: "complete_task",
	label: "Complete Task",
	description:
		"Signal that you have finished the task. Call this exactly once, as your final action, after you have submitted or edited everything you intend to.",
	promptSnippet: "Signal task completion",
	promptGuidelines: [
		"Call complete_task exactly once when you are done. It must be your final action.",
	],
	parameters: Type.Object({}),
	executionMode: "sequential",
	completion: { nudge: completionNudge },
	async execute() {
		return toolResult("Completion recorded, terminating.", undefined, {
			terminate: true,
		});
	},
});

export const COMPLETION_MAX_CONTINUATIONS = 3;

export type CompletionTool = AgentToolDefinition & {
	completion: { nudge: string };
};

export const findCompletionTool = (
	agentId: string,
	tools: AgentToolDefinition[],
): CompletionTool | undefined => {
	const completionTools = tools.filter(
		(tool): tool is CompletionTool => tool.completion !== undefined,
	);
	if (completionTools.length > 1) {
		throw new Error(
			`Agent ${agentId} defines multiple completion tools (${completionTools
				.map((tool) => tool.name)
				.join(", ")}). At most one is allowed.`,
		);
	}
	return completionTools[0];
};

export type CompletionTracker = {
	tools: AgentToolDefinition[];
	isCompleted: () => boolean;
};

export const trackCompletion = (
	tools: AgentToolDefinition[],
	completionTool: CompletionTool | undefined,
): CompletionTracker => {
	let completed = false;
	const tracked = tools.map((tool) =>
		tool === completionTool
			? {
					...tool,
					execute: async (toolCallId: string, params: unknown) => {
						completed = true;
						return tool.execute(toolCallId, params);
					},
				}
			: tool,
	);
	return { tools: tracked, isCompleted: () => completed };
};

export type CompletionLoopOptions = {
	session: Pick<RuntimeSession, "prompt">;
	completionTool: CompletionTool;
	isCompleted: () => boolean;
	isTerminated: () => boolean;
	log: ScopedLogger;
};

export const runCompletionLoop = async ({
	session,
	completionTool,
	isCompleted,
	isTerminated,
	log,
}: CompletionLoopOptions): Promise<number> => {
	const max = COMPLETION_MAX_CONTINUATIONS;
	let continuations = 0;
	while (!isCompleted() && continuations < max && !isTerminated()) {
		continuations += 1;
		log.info(
			"Agent stopped without completing, re-prompting",
			`${continuations}/${max}`,
		);
		await session.prompt(completionTool.completion.nudge);
	}
	if (!isCompleted() && !isTerminated()) {
		log.error(
			"Agent did not complete after re-prompting",
			`${continuations}/${max}`,
		);
	}
	return continuations;
};
