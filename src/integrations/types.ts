export type ChangeSet = {
	repositoryDir: string;
	diff: string;
};

export interface ChangeSource {
	load: () => Promise<ChangeSet>;
}
