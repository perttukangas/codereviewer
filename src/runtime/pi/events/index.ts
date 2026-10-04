import type {
	AgentSessionEvent,
	AgentSession as PiAgentSession,
} from "@earendil-works/pi-coding-agent";

import type { ScopedLogger } from "../../../shared/logger.js";
import { describeAgentEvent, describeAssistantMessage } from "./describe.js";
import { collectAgentUsage, summarizeAgentUsage } from "./usage.js";

export type { AgentUsage } from "../../types.js";

export type AgentDiagnostics = {
	systemPrompt: string;
	tools: string[];
};

export const logAgentEvent = (
	log: ScopedLogger,
	event: AgentSessionEvent,
	turnNumber: number,
	toolInputs: Map<string, unknown>,
): number => {
	if (event.type === "message_update" && event.message.role === "assistant") {
		return turnNumber;
	}
	if (event.type === "message_end" && event.message.role === "assistant") {
		const described = describeAssistantMessage(event.message);
		if (event.message.stopReason === "aborted") {
			log.debug("Agent message aborted", described);
		} else if (event.message.errorMessage) {
			log.error("Agent message ended with error", {
				error: event.message.errorMessage,
				...described,
			});
		} else {
			log.debug("Agent completed message", described);
		}
		return turnNumber;
	}

	if (event.type === "turn_start") {
		turnNumber += 1;
	}

	if (event.type === "tool_execution_start") {
		toolInputs.set(event.toolCallId, event.args);
	}

	const described = describeAgentEvent(event, turnNumber);
	if (event.type === "agent_end" && "aborted" in described) {
		log.debug("Agent ended (aborted)", described);
	} else if (event.type === "agent_end" && "error" in described) {
		log.error("Agent ended with error", described);
	} else if (event.type === "tool_execution_end") {
		const input = toolInputs.get(event.toolCallId);
		toolInputs.delete(event.toolCallId);
		if (event.isError) {
			log.error("Tool call failed", {
				...described,
				...(input === undefined ? {} : { input }),
			});
		} else {
			log.debug("Agent event", event.type, described);
		}
	} else {
		log.debug("Agent event", event.type, described);
	}
	return turnNumber;
};

export const logAgentResult = (
	log: ScopedLogger,
	session: PiAgentSession,
): void => {
	const usage = collectAgentUsage(session);
	log.info("Agent usage", summarizeAgentUsage(usage));
	log.debug("Agent usage details", usage);
};

export const logAgentDiagnostics = (
	log: ScopedLogger,
	diagnostics: AgentDiagnostics,
): void => {
	log.debug("Agent diagnostics", diagnostics);
};

export const logAgentToolSchemas = (
	log: ScopedLogger,
	tools: { name: string; parameters: unknown }[],
): void => {
	log.debug(
		"Agent tool schemas",
		tools.map((tool) => ({ name: tool.name, parameters: tool.parameters })),
	);
};
