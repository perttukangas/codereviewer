import type { WorkflowResult } from "../../types.js";
import type { ReviewReport } from "../types.js";

export const renderReviewReport = (
	result: WorkflowResult<ReviewReport>,
): string => JSON.stringify(result, null, 2).replaceAll("\\n", "\n");
