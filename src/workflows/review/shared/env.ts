import { cleanEnv, str } from "envalid";

export const reviewModes = ["multi", "single"] as const;

export type ReviewMode = (typeof reviewModes)[number];

export const getReviewEnv = () =>
	cleanEnv(process.env, {
		GIT_DIFF_PATH: str({
			desc: "The path to the git diff file.",
		}),
		REVIEW_MODE: str({
			choices: reviewModes,
			default: "multi",
			desc: "The review architecture. multi runs the specialized review agents, single runs one generalist agent.",
		}),
	});
