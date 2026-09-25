import { info } from "../../platform/logger.js";
import { getWorkflow } from "../../workflows/registry.js";
import { renderReviewReport } from "../../workflows/review/report/json.js";
import type { ReviewReport } from "../../workflows/review/types.js";
import type { WorkflowResult } from "../../workflows/types.js";
import type { Command } from "./types.js";

export const reviewCommand: Command = {
	id: "review",
	run: async (context) => {
		const result = (await getWorkflow("review").run(
			context,
		)) as WorkflowResult<ReviewReport>;
		info(renderReviewReport(result));
	},
};
