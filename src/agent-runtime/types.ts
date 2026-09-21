export type Agent = {
	id: string;
	tools: ("read" | "grep" | "find" | "ls")[];
	prompt: string;
};

export type AgentModel = {
	name: string;
	samplingParams: Record<string, unknown>;
};

export type AgentLimits = {
	contextWindow: number;
	maxOutputTokens: number;
};

export interface AgentSession {
	prompt: (prompt: string) => Promise<void>;
	dispose: () => void;
}
