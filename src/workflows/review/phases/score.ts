import { createLogger } from "../../../shared/logger.js";
import type { Phase } from "../../pipeline.js";
import { allFindings, logFindingsSnapshot } from "../shared/findings.js";
import { scoreFindings } from "../shared/scoring.js";
import type { ReviewPipelineState } from "../types.js";

export const score: Phase<ReviewPipelineState> = {
	id: "score",
	run: async (state) => {
		const { report } = state;
		const log = createLogger();

		scoreFindings(report);

		logFindingsSnapshot(log, "Scored findings", allFindings(report));

		return state;
	},
};
