import type { ReviewSeverity } from "../../types.js";

export const severityValues = [
	"CRITICAL",
	"HIGH",
	"MEDIUM",
	"LOW",
	"INFO",
] as const;

export const severityRank = (severity: ReviewSeverity): number =>
	severityValues.indexOf(severity);
