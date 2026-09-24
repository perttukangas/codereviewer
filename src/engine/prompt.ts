export type PromptSection = {
	heading: string;
	items: string[];
};

export type PromptBlock = {
	heading: string;
	body: string;
};

export const toTitle = (id: string): string =>
	id
		.split("-")
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join(" ");

export const formatPrompt = (input: {
	title: string;
	intro: string;
	sections?: PromptSection[];
	blocks?: PromptBlock[];
}): string => {
	const parts = [`# ${input.title}`, input.intro];

	for (const section of input.sections ?? []) {
		if (section.items.length === 0) {
			continue;
		}
		parts.push(`## ${section.heading}`);
		parts.push(section.items.map((item) => `- ${item}`).join("\n"));
	}

	for (const block of input.blocks ?? []) {
		parts.push(`## ${block.heading}`);
		parts.push(block.body);
	}

	return parts.join("\n\n");
};
