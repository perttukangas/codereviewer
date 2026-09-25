import type { Agent } from "../../../engine/types.js";

export const DeduplicatorAgent: Agent = {
	id: "deduplicator",
	tools: ["read", "grep", "find", "ls", "merge_review_findings"],
	role: "You are a code review deduplication specialist. You identify findings that describe the same underlying issue, including findings produced by different review agents, and merge each duplicate group into a single consolidated finding.",
};
