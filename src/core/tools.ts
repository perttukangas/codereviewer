import type { Static, TSchema } from "typebox";

export type ToolTextContent = {
	type: "text";
	text: string;
};

export type ToolResult<TDetails = unknown> = {
	content: ToolTextContent[];
	details?: TDetails;
};

export type AgentToolDefinition<TParams extends TSchema = TSchema> = {
	name: string;
	label: string;
	description: string;
	promptSnippet?: string;
	promptGuidelines?: string[];
	parameters: TParams;
	execute: (toolCallId: string, params: Static<TParams>) => Promise<ToolResult>;
};

export const defineTool = <TParams extends TSchema>(
	tool: AgentToolDefinition<TParams>,
): AgentToolDefinition<TParams> => tool;
