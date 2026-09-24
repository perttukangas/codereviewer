import type { ReviewReport } from "../types.js";

export const renderReviewReport = (report: ReviewReport): string =>
	JSON.stringify(report, null, 2).replaceAll("\\n", "\n");
