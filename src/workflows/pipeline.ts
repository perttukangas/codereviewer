export type Phase<TInput, TOutput = TInput> = {
	id: string;
	run: (input: TInput) => Promise<TOutput>;
};

export const runPipeline = async <TSeed, TState>(
	seed: TSeed,
	phases: readonly [Phase<TSeed, TState>, ...Phase<TState, TState>[]],
): Promise<TState> => {
	const [first, ...rest] = phases;
	let state = await first.run(seed);

	for (const phase of rest) {
		state = await phase.run(state);
	}

	return state;
};
