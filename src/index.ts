import { orchestrate } from "./orchestrator/index.js";
import { validateInputs } from "./utils/env.js";
import { info } from "./utils/logger.js";

const main = async () => {
	await validateInputs();
	const responses = await orchestrate();
	info(JSON.stringify(responses, null, 2).replaceAll("\\n", "\n"));
};

await main();
