import { createLocalGitChangeSource } from "../../../integrations/local-git.js";
import type { ChangeSource } from "../../../integrations/types.js";
import { info } from "../../../shared/logger.js";
import type { Phase } from "../../pipeline.js";
import { getReviewEnv } from "../shared/env.js";
import { validateReviewInputs } from "../shared/validate-inputs.js";
import type { ReviewPipelineState, ReviewSeed } from "../types.js";

export const loadChanges: Phase<ReviewSeed, ReviewPipelineState> = {
	id: "load-changes",
	run: async (seed) => {
		await validateReviewInputs();

		const { GIT_DIFF_PATH } = getReviewEnv();
		const changeSource: ChangeSource =
			createLocalGitChangeSource(GIT_DIFF_PATH);

		info("Reading Git diff", GIT_DIFF_PATH);
		const changeSet = await changeSource.load();

		return { ...seed, changeSet };
	},
};
