import { readFile } from "node:fs/promises";

import { env } from "../platform/env.js";
import type { ChangeSet, ChangeSource } from "./types.js";

export const createLocalGitChangeSource = (diffPath: string): ChangeSource => ({
	load: async (): Promise<ChangeSet> => {
		const diff = await readFile(diffPath, "utf8");
		return {
			repositoryDir: env.REPO_DIR,
			diff,
		};
	},
});
