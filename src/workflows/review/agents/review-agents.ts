import type { Agent } from "../../../engine/types.js";
import { CorrectnessAgent } from "./correctness.js";
import { MaintainabilityAgent } from "./maintainability.js";
import { PerformanceAgent } from "./performance.js";
import { ReliabilityAgent } from "./reliability.js";
import { SecurityAgent } from "./security.js";

export const reviewAgents = [
	CorrectnessAgent,
	MaintainabilityAgent,
	PerformanceAgent,
	ReliabilityAgent,
	SecurityAgent,
] as const satisfies readonly Agent[];

export const reviewScopeValues: readonly string[] = reviewAgents.map(
	(agent) => agent.id,
);
