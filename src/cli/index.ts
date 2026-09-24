import { createAgentRuntime } from "../runtime/create-runtime.js";
import { listWorkflows } from "../workflows/registry.js";
import type { WorkflowContext } from "../workflows/types.js";
import { reviewCommand } from "./commands/review.js";
import type { Command } from "./commands/types.js";

const defaultCommandId = "review";

const commands = new Map<string, Command>(
	[reviewCommand].map((command) => [command.id, command]),
);

const parseCommandId = (argv: string[]): string => {
	const [command] = argv;
	if (!command || command.startsWith("-")) {
		return defaultCommandId;
	}
	return command;
};

export const run = async (argv: string[]): Promise<void> => {
	if (argv.includes("--help")) {
		console.log(
			`Usage: codereviewer [command]\n\nCommands: ${[...commands.keys()].join(", ")}\nWorkflows: ${listWorkflows().join(", ")}`,
		);
		return;
	}

	const commandId = parseCommandId(argv);
	const command = commands.get(commandId);
	if (!command) {
		throw new Error(
			`Unknown command: ${commandId}. Available commands: ${[...commands.keys()].join(", ")}`,
		);
	}

	const context: WorkflowContext = { runtime: createAgentRuntime() };
	await command.run(context);
};
