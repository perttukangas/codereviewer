import type { Agent } from "../../../engine/types.js";
import { CodeQualityAgent } from "./code-quality.js";
import { CorrectnessAgent } from "./correctness.js";
import { PerformanceAgent } from "./performance.js";
import { ReliabilityAgent } from "./reliability.js";
import { SecurityAgent } from "./security.js";

export const reviewAgents: Agent[] = [
	CorrectnessAgent,
	CodeQualityAgent,
	PerformanceAgent,
	ReliabilityAgent,
	SecurityAgent,
];
