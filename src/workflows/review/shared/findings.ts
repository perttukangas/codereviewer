import type { ScopedLogger } from "../../../shared/logger.js";
import {
	severityRank,
	severityValues,
} from "../tools/review-finding/severity.js";
import type { ReviewFinding } from "../types.js";

export const canonicalFinding = (finding: ReviewFinding): ReviewFinding => {
	const canonical: ReviewFinding = {
		id: finding.id,
		title: finding.title,
		severity: finding.severity,
		confidence: finding.confidence,
		problem: finding.problem,
		suggestedChange: finding.suggestedChange,
		relatedFiles: finding.relatedFiles,
		rationale: finding.rationale,
	};

	if (finding.scope !== undefined) {
		canonical.scope = finding.scope;
	}
	if (finding.codeChangeFilePath !== undefined) {
		canonical.codeChangeFilePath = finding.codeChangeFilePath;
	}
	if (finding.codeChangeOldText !== undefined) {
		canonical.codeChangeOldText = finding.codeChangeOldText;
	}
	if (finding.codeChangeNewText !== undefined) {
		canonical.codeChangeNewText = finding.codeChangeNewText;
	}
	if (finding.codeChangeStartLine !== undefined) {
		canonical.codeChangeStartLine = finding.codeChangeStartLine;
	}
	if (finding.codeChangeEndLine !== undefined) {
		canonical.codeChangeEndLine = finding.codeChangeEndLine;
	}
	if (finding.invalidReason !== undefined) {
		canonical.invalidReason = finding.invalidReason;
	}
	if (finding.mergedFrom !== undefined) {
		canonical.mergedFrom = finding.mergedFrom;
	}
	if (finding.mergedFindingIds !== undefined) {
		canonical.mergedFindingIds = finding.mergedFindingIds;
	}
	if (finding.score !== undefined) {
		canonical.score = finding.score;
	}

	return canonical;
};

const sortFindings = (findings: ReviewFinding[]): ReviewFinding[] =>
	[...findings].sort((a, b) => {
		const bySeverity = severityRank(a.severity) - severityRank(b.severity);
		if (bySeverity !== 0) {
			return bySeverity;
		}

		return a.id.localeCompare(b.id, "en", { numeric: true });
	});

export const orderFindingsForPrompt = (
	findings: ReviewFinding[],
): ReviewFinding[] => sortFindings(findings).map(canonicalFinding);

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

	if (finding.score !== undefined) {
		parts.push(`score ${finding.score}`);
	}

	if (finding.scope !== undefined && finding.scope.length > 0) {
		parts.push(`scope ${finding.scope.join(", ")}`);
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
