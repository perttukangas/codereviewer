import type {
	AgentSessionEvent,
	AgentSession as PiAgentSession,
} from "@earendil-works/pi-coding-agent";

import { debug } from "../../../shared/logger.js";
import { describeAgentEvent, describeAssistantMessage } from "./describe.js";
import { collectAgentUsage } from "./usage.js";

export type { AgentUsage } from "../../types.js";

export type AgentDiagnostics = {
	systemPrompt: string;
	tools: string[];
};

export const logAgentEvent = (
	agentId: string,
	event: AgentSessionEvent,
	turnNumber: number,
): number => {
	if (event.type === "message_update" && event.message.role === "assistant") {
		return turnNumber;
	}
	if (event.type === "message_end" && event.message.role === "assistant") {
		debug(
			"Agent completed message",
			agentId,
			describeAssistantMessage(event.message),
		);
		return turnNumber;
	}

	if (event.type === "turn_start") {
		turnNumber += 1;
	}
	debug(
		"Agent event",
		agentId,
		event.type,
		describeAgentEvent(event, turnNumber),
	);
	return turnNumber;
};

export const logAgentResult = (
	agentId: string,
	session: PiAgentSession,
): void => {
	debug("Agent usage", agentId, collectAgentUsage(session));
};

export const logAgentDiagnostics = (
	agentId: string,
	diagnostics: AgentDiagnostics,
): void => {
	debug("Agent diagnostics", agentId, diagnostics);
};
