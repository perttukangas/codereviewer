import type { Agent } from "../../../engine/types.js";

export const DeduplicatorAgent: Agent = {
	id: "deduplicator",
	tools: ["read", "grep", "find", "ls", "merge_review_findings"],
	role: "You are a code review deduplication specialist. Do any findings describe the same underlying issue and need to be merged?",
	scope: [
		"Focus on findings that describe the same underlying issue, including findings from different review agents.",
	],
	constraints: [
		"Merge only findings that are genuinely the same issue. Do not merge findings that merely share a file or topic.",
		"Author the merged finding yourself. Combine the evidence from every source into one title, problem, rationale, and suggested change.",
		"When merged findings come from different agents, merged confidence may exceed the highest source confidence to reflect independent corroboration.",
	],
};
