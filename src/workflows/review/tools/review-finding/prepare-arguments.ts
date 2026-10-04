import { reviewCategoryValues } from "../../agents/review-agents.js";
import { confidenceValues, severityValues } from "../../shared/scoring.js";

const normalizeEnumValue = (
	field: string,
	value: unknown,
	allowed: readonly string[],
): unknown => {
	if (typeof value !== "string") {
		return value;
	}

	const trimmed = value.trim();
	const match = allowed.find(
		(candidate) => candidate.toUpperCase() === trimmed.toUpperCase(),
	);

	if (match !== undefined) {
		return match;
	}

	throw new Error(
		`Invalid ${field} "${value}". Allowed values: ${allowed.join(", ")}.`,
	);
};

const normalizeEnumArray = (
	field: string,
	value: unknown,
	allowed: readonly string[],
): unknown => {
	if (!Array.isArray(value)) {
		return value;
	}

	return value.map((item) => normalizeEnumValue(field, item, allowed));
};

export const prepareFindingArguments = (args: unknown): unknown => {
	if (typeof args !== "object" || args === null || Array.isArray(args)) {
		return args;
	}

	const input = args as Record<string, unknown>;
	const prepared: Record<string, unknown> = { ...input };

	if ("severity" in prepared) {
		prepared.severity = normalizeEnumValue(
			"severity",
			prepared.severity,
			severityValues,
		);
	}

	if ("confidence" in prepared) {
		prepared.confidence = normalizeEnumValue(
			"confidence",
			prepared.confidence,
			confidenceValues,
		);
	}

	if ("categories" in prepared) {
		prepared.categories = normalizeEnumArray(
			"categories",
			prepared.categories,
			reviewCategoryValues,
		);
	}

	return prepared;
};
