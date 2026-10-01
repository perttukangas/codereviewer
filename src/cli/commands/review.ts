import { writeFile } from "node:fs/promises";
import { info } from "../../shared/logger.js";
import { getWorkflow } from "../../workflows/registry.js";
import { renderReviewReport } from "../../workflows/review/report/json.js";
import type { ReviewReport } from "../../workflows/review/types.js";
import type { WorkflowResult } from "../../workflows/types.js";
import type { Command } from "./types.js";

export const reviewCommand: Command = {
	id: "review",
	run: async (context, options) => {
		const result = (await getWorkflow("review").run(
			context,
		)) as WorkflowResult<ReviewReport>;
		const report = renderReviewReport(result);

		if (options.output) {
			await writeFile(options.output, report, "utf8");
			info("Wrote review report", options.output);
			return;
		}

		info(report);
	},
};
