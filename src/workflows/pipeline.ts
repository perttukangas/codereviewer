import { createLogger } from "../shared/logger.js";

export type Phase<TInput, TOutput = TInput> = {
	id: string;
	run: (input: TInput) => Promise<TOutput>;
};

const log = createLogger();

const runPhase = async <TInput, TOutput>(
	phase: Phase<TInput, TOutput>,
	input: TInput,
): Promise<TOutput> => {
	const timerId = `phase:${phase.id}`;
	log.startTimer(timerId, "Starting phase");

	try {
		return await phase.run(input);
	} finally {
		log.stopTimer(timerId, "Completed phase");
	}
};

export const runPipeline = async <TSeed, TState>(
	seed: TSeed,
	phases: readonly [Phase<TSeed, TState>, ...Phase<TState, TState>[]],
): Promise<TState> => {
	const [first, ...rest] = phases;
	let state = await runPhase(first, seed);

	for (const phase of rest) {
		state = await runPhase(phase, state);
	}

	return state;
};
