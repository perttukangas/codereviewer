import type { Agent } from "../../../engine/types.js";
import { CodeQualityAgent } from "./code-quality.js";
import { PerformanceAgent } from "./performance.js";

export const reviewAgents: Agent[] = [CodeQualityAgent, PerformanceAgent];
