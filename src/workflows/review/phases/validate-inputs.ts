import { access, constants, stat } from "node:fs/promises";

import { env } from "../../../platform/env.js";
import { getReviewEnv } from "../env.js";

export const validateReviewInputs = async (): Promise<void> => {
	const { GIT_DIFF_PATH } = getReviewEnv();

	const repository = await stat(env.REPO_DIR).catch(() => undefined);
	if (!repository?.isDirectory()) {
		throw new Error(`REPO_DIR is not a readable directory: ${env.REPO_DIR}`);
	}

	const diff = await stat(GIT_DIFF_PATH).catch(() => undefined);
	if (!diff?.isFile()) {
		throw new Error(`GIT_DIFF_PATH is not a readable file: ${GIT_DIFF_PATH}`);
	}

	await access(env.REPO_DIR, constants.R_OK);
	await access(GIT_DIFF_PATH, constants.R_OK);
};
