import { readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";

type EnvironmentVariable = {
	name: string;
	type: string;
	defaultValue: string;
	choices: string[];
	description: string;
};

const root = join(dirname(import.meta.filename), "..");
const sourceRoot = join(root, "src");
const startMarker = "<!-- BEGIN GENERATED ENVIRONMENT VARIABLES -->";
const endMarker = "<!-- END GENERATED ENVIRONMENT VARIABLES -->";

const workflowIndex = process.argv.indexOf("--workflow");
const workflowId = workflowIndex >= 0 ? process.argv[workflowIndex + 1] : undefined;
if (workflowIndex >= 0 && !workflowId) {
	throw new Error("--workflow requires a workflow id");
}

const sourceDirectory = workflowId
	? join(sourceRoot, "workflows", workflowId)
	: sourceRoot;
const readmePath = workflowId
	? join(sourceDirectory, "README.md")
	: join(root, "README.md");

const filesUnder = async (directory: string): Promise<string[]> => {
	const entries = await readdir(directory, { withFileTypes: true });
	const files: string[] = [];
	for (const entry of entries) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) {
			files.push(...(await filesUnder(path)));
		} else if (entry.name.endsWith(".ts")) {
			files.push(path);
		}
	}
	return files;
};

const value = (options: string, name: string): string => {
	const match = options.match(
		new RegExp(
			`\\b${name}:\\s*(\\{[^}]*\\}|"(?:\\\\.|[^"\\\\])*"|'(?:\\\\.|[^'\\\\])*'|[^,\\n]+)`,
		),
	);
	return match?.[1]?.trim().replace(/^['"]|['"]$/g, "") ?? "—";
};

const descriptionFor = (name: string, description: string): string => {
	if (description !== "—") return description;
	const suffix = name
		.replace("<AGENT>", "")
		.replace(/^_/, "")
		.replaceAll("_", " ")
		.toLowerCase();
	return `Per-agent override for ${suffix}.`;
};

const choicesFrom = (source: string, options: string): string[] => {
	const expression = options.match(
		/\bchoices:\s*(\[[^\]]*\]|[^,\n]+)/,
	)?.[1]
		.trim();
	if (!expression) return [];

	const values = expression.startsWith("[")
		? expression
		: source.match(
				new RegExp(
					`(?:const|export\\s+const)\\s+${expression}\\s*=\\s*(\\[[^\\]]*\\])`,
				),
			)?.[1];
	if (!values) return [];

	return [...values.matchAll(/["']([^"']+)["']/g)].map(
		([, choice]) => choice,
	);
};

const variablesFrom = (source: string): EnvironmentVariable[] => {
	const variables: EnvironmentVariable[] = [];
	const schema = source.match(
		/cleanEnv\(process\.env,\s*\{([\s\S]*?)\n\s*\}\);/,
	);
	if (!schema) return variables;

	const propertyPattern =
		/(?:^|\n)\s*(\[[^\]]+\]|[A-Z][A-Z0-9_]*)\s*:\s*([A-Za-z_$][^\n(]*?)\s*\(\{([\s\S]*?)\}\),/g;
	for (const match of schema[1].matchAll(propertyPattern)) {
		const rawName = match[1];
		const type = match[2].trim().split("<", 1)[0];
		const agentSuffix = rawName.match(/\$\{prefix\}([^`]*)/);
		const name = rawName.startsWith("[")
			? agentSuffix
				? `<AGENT>${agentSuffix[1]}`
				: undefined
			: rawName;
		if (!name) continue;
		const defaultValue = value(match[3], "default").replace(/^env\./, "");
		const choices = choicesFrom(source, match[3]);
		const description = descriptionFor(name, value(match[3], "desc"));
		variables.push({ name, type, defaultValue, choices, description });
	}
	return variables;
};

const markdown = (
	variables: EnvironmentVariable[],
	isWorkflow: boolean,
): string =>
	[
		"## Environment variables",
		"",
		isWorkflow
			? "Workflow-specific variables are discovered from `cleanEnv` schemas in this workflow."
			: "Application-wide variables are discovered from `cleanEnv` schemas. Workflow-specific variables are documented with their workflow.",
		...(isWorkflow
			? []
			: ["Per-agent overrides use the uppercased agent id as the prefix."]),
		"",
		"| Environment variable | Type | Default | Choices | Description |",
		"| --- | --- | --- | --- | --- |",
		...variables.map(
			({ name, type, defaultValue, choices, description }) =>
				`| \`${name}\` | \`${type}\` | \`${defaultValue.replaceAll("|", "\\|")}\` | \`${(choices.length ? choices.join(", ") : "—").replaceAll("|", "\\|")}\` | ${description.replaceAll("|", "\\|")} |`,
		),
	].join("\n");

const updateReadme = (readme: string, section: string): string => {
	const start = readme.indexOf(startMarker);
	const end = readme.indexOf(endMarker);
	if (start < 0 || end < start) {
		throw new Error("README markers are missing or invalid");
	}
	return `${readme.slice(0, start)}${startMarker}\n\n${section}\n\n${endMarker}${readme.slice(end + endMarker.length)}`;
};

const variables: EnvironmentVariable[] = [];
const seen = new Set<string>();
for (const file of (await filesUnder(sourceDirectory)).sort()) {
	if (!workflowId && relative(sourceRoot, file).startsWith("workflows/")) continue;
	for (const variable of variablesFrom(await readFile(file, "utf8"))) {
		if (!seen.has(variable.name)) {
			seen.add(variable.name);
			variables.push(variable);
		}
	}
}

const readme = await readFile(readmePath, "utf8");
const agentVariables = variables.filter(({ name }) => name.startsWith("<AGENT>"));

const documentedVariables: EnvironmentVariable[] = !workflowId && agentVariables.length
	? [
			{
				name: "<AGENT>_*",
				type: "Varies",
				defaultValue: "Varies",
				choices: ["Varies"],
				description: `Per-agent overrides for ${agentVariables
					.map(({ name }) => `\`${name.replace("<AGENT>_", "")}\``)
					.join(", ")}. Defaults come from the corresponding DEFAULT_* variables.`,
			},
			...variables.filter(({ name }) => !name.startsWith("<AGENT>")),
		]
	: variables;
await writeFile(
	readmePath,
	updateReadme(readme, markdown(documentedVariables, Boolean(workflowId))),
);