import { createPiRuntime } from "./pi/index.js";
import type { AgentRuntime } from "./types.js";

export type { AgentRuntime } from "./types.js";

export const createAgentRuntime = (): AgentRuntime => createPiRuntime();
