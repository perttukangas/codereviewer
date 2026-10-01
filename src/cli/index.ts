import { createAgentRuntime } from "../runtime/create-runtime.js";
import { info } from "../shared/logger.js";
import { listWorkflows } from "../workflows/registry.js";
import type { WorkflowContext } from "../workflows/types.js";
import { reviewCommand } from "./commands/review.js";
import type { Command, CommandOptions } from "./commands/types.js";

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

const parseOptions = (argv: string[]): CommandOptions => {
	const options: CommandOptions = {};

	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--output") {
			const value = argv[index + 1];
			if (!value || value.startsWith("-")) {
				throw new Error("--output requires a file path.");
			}
			options.output = value;
			index += 1;
		}
	}

	return options;
};

export const run = async (argv: string[]): Promise<void> => {
	if (argv.includes("--help")) {
		info(
			`Usage: codereviewer [command] [--output <path>]\n\nCommands: ${[...commands.keys()].join(", ")}\nWorkflows: ${listWorkflows().join(", ")}`,
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
	await command.run(context, parseOptions(argv));
};
