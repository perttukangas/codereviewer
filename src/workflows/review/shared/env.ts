import { cleanEnv, str } from "envalid";

export const getReviewEnv = () =>
	cleanEnv(process.env, {
		GIT_DIFF_PATH: str({
			desc: "The path to the git diff file.",
		}),
	});
