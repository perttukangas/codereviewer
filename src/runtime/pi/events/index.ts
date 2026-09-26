import type {
	AgentSessionEvent,
	AgentSession as PiAgentSession,
} from "@earendil-works/pi-coding-agent";

import type { ScopedLogger } from "../../../shared/logger.js";
import { describeAgentEvent, describeAssistantMessage } from "./describe.js";
import { collectAgentUsage } from "./usage.js";

export type { AgentUsage } from "../../types.js";

export type AgentDiagnostics = {
	systemPrompt: string;
	tools: string[];
};

export const logAgentEvent = (
	log: ScopedLogger,
	event: AgentSessionEvent,
	turnNumber: number,
): number => {
	if (event.type === "message_update" && event.message.role === "assistant") {
		return turnNumber;
	}
	if (event.type === "message_end" && event.message.role === "assistant") {
		const described = describeAssistantMessage(event.message);
		if (event.message.errorMessage) {
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

	const described = describeAgentEvent(event, turnNumber);
	if (event.type === "agent_end" && "error" in described) {
		log.error("Agent ended with error", described);
	} else {
		log.debug("Agent event", event.type, described);
	}
	return turnNumber;
};

export const logAgentResult = (
	log: ScopedLogger,
	session: PiAgentSession,
): void => {
	log.debug("Agent usage", collectAgentUsage(session));
};

export const logAgentDiagnostics = (
	log: ScopedLogger,
	diagnostics: AgentDiagnostics,
): void => {
	log.debug("Agent diagnostics", diagnostics);
};
