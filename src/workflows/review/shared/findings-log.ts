import type { ScopedLogger } from "../../../shared/logger.js";
import { severityValues } from "../tools/review-finding/index.js";
import type { ReviewFinding } from "../types.js";

const summarizeFinding = (finding: ReviewFinding): string => {
	const parts = [
		finding.id,
		finding.severity,
		`confidence ${finding.confidence}`,
		finding.title,
	];

	if (finding.invalidReason !== undefined) {
		parts.push(`invalid (${finding.invalidReason})`);
	}

	if (finding.mergedFrom !== undefined && finding.mergedFrom.length > 0) {
		parts.push(`merged from ${finding.mergedFrom.join(", ")}`);
	}

	return parts.join(" | ");
};

const severityBreakdown = (findings: ReviewFinding[]): string =>
	severityValues
		.map(
			(severity) =>
				`${severity}=${findings.filter((finding) => finding.severity === severity).length}`,
		)
		.join(", ");

export const logFindingsSnapshot = (
	log: ScopedLogger,
	label: string,
	findings: ReviewFinding[],
): void => {
	log.info(`${label} ${findings.length}`, severityBreakdown(findings));

	for (const finding of findings) {
		log.info(`- ${summarizeFinding(finding)}`);
	}

	log.debug(`${label} details`, findings);
};
