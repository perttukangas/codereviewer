import type { Agent } from "../../../engine/types.js";
import { GeneralistAgent } from "./generalist.js";
import { reviewAgents } from "./review-agents.js";

export { reviewAgents };

export const singleReviewAgents: Agent[] = [GeneralistAgent];
