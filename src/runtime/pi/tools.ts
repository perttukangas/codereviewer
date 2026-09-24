import {
	type ToolDefinition as PiToolDefinition,
	defineTool as piDefineTool,
} from "@earendil-works/pi-coding-agent";
import type { AgentToolDefinition } from "../../engine/tools.js";

export const toPiTool = (tool: AgentToolDefinition): PiToolDefinition => {
	return piDefineTool({
		name: tool.name,
		label: tool.label,
		description: tool.description,
		promptSnippet: tool.promptSnippet,
		promptGuidelines: tool.promptGuidelines,
		parameters: tool.parameters,
		executionMode: tool.executionMode,
		async execute(toolCallId, params) {
			const result = await tool.execute(toolCallId, params);
			return {
				content: result.content,
				details: result.details,
			};
		},
	});
};
