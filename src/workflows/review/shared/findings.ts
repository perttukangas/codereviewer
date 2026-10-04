import type { ScopedLogger } from "../../../shared/logger.js";
import type { ReviewFinding, ReviewReport } from "../types.js";
import { severityRank, severityValues } from "./scoring.js";

export const allFindings = (report: ReviewReport): ReviewFinding[] =>
	Object.values(report).flatMap((review) => review.findings);

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
	if (finding.codeChangesOverlap !== undefined) {
		canonical.codeChangesOverlap = finding.codeChangesOverlap;
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

const compareByScore = (a: ReviewFinding, b: ReviewFinding): number => {
	if (a.score === undefined && b.score === undefined) {
		return 0;
	}
	if (a.score === undefined) {
		return 1;
	}
	if (b.score === undefined) {
		return -1;
	}

	return b.score - a.score;
};

const sortFindingsForLog = (findings: ReviewFinding[]): ReviewFinding[] =>
	[...findings].sort((a, b) => {
		const byScore = compareByScore(a, b);
		if (byScore !== 0) {
			return byScore;
		}

		const bySeverity = severityRank(a.severity) - severityRank(b.severity);
		if (bySeverity !== 0) {
			return bySeverity;
		}

		return a.id.localeCompare(b.id, "en", { numeric: true });
	});

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

	if (
		finding.codeChangesOverlap !== undefined &&
		finding.codeChangesOverlap.length > 0
	) {
		parts.push(`overlaps ${finding.codeChangesOverlap.join(", ")}`);
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
	const ordered = sortFindingsForLog(findings);

	log.info(`${label} ${findings.length}`, severityBreakdown(findings));

	for (const finding of ordered) {
		log.info(`- ${summarizeFinding(finding)}`);
	}

	log.debug(`${label} details`, ordered);
};

type FindingWithCodeChange = ReviewFinding &
	Required<
		Pick<
			ReviewFinding,
			"codeChangeFilePath" | "codeChangeStartLine" | "codeChangeEndLine"
		>
	>;

const hasCodeChange = (
	finding: ReviewFinding,
): finding is FindingWithCodeChange =>
	finding.codeChangeFilePath !== undefined &&
	finding.codeChangeStartLine !== undefined &&
	finding.codeChangeEndLine !== undefined;

const rangesOverlap = (
	a: FindingWithCodeChange,
	b: FindingWithCodeChange,
): boolean =>
	a.codeChangeStartLine <= b.codeChangeEndLine &&
	b.codeChangeStartLine <= a.codeChangeEndLine;

const compareIds = (a: string, b: string): number =>
	a.localeCompare(b, "en", { numeric: true });

export const flagCodeChangeOverlaps = (
	report: ReviewReport,
): ReviewFinding[] => {
	const findings = allFindings(report);

	for (const finding of findings) {
		delete finding.codeChangesOverlap;
	}

	const overlapping = new Map<string, Set<string>>();
	const addOverlap = (id: string, otherId: string): void => {
		const ids = overlapping.get(id) ?? new Set<string>();
		ids.add(otherId);
		overlapping.set(id, ids);
	};

	for (let i = 0; i < findings.length; i++) {
		const a = findings[i];
		if (!hasCodeChange(a)) {
			continue;
		}

		for (let j = i + 1; j < findings.length; j++) {
			const b = findings[j];
			if (!hasCodeChange(b)) {
				continue;
			}

			if (a.codeChangeFilePath !== b.codeChangeFilePath) {
				continue;
			}

			if (!rangesOverlap(a, b)) {
				continue;
			}

			addOverlap(a.id, b.id);
			addOverlap(b.id, a.id);
		}
	}

	const flagged: ReviewFinding[] = [];
	for (const finding of findings) {
		const ids = overlapping.get(finding.id);
		if (ids === undefined || ids.size === 0) {
			continue;
		}

		finding.codeChangesOverlap = [...ids].sort(compareIds);
		flagged.push(finding);
	}

	return flagged;
};
