export type Semaphore = {
	acquire: () => Promise<() => void>;
};

export const createSemaphore = (limit: number): Semaphore => {
	if (limit <= 0) {
		return {
			acquire: async () => () => undefined,
		};
	}

	let available = limit;
	const waiters: Array<() => void> = [];

	const release = (): void => {
		const next = waiters.shift();
		if (next) {
			next();
			return;
		}
		available += 1;
	};

	return {
		acquire: async (): Promise<() => void> => {
			if (available > 0) {
				available -= 1;
				return release;
			}

			await new Promise<void>((resolve) => {
				waiters.push(resolve);
			});
			return release;
		},
	};
};
