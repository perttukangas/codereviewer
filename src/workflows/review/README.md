# Review

Code review workflow

## Architecture

```mermaid
flowchart LR
	Command[Review command] --> Load[Phase 1<br/>Load changes]
	Load --> ReviewPhase[Phase 2<br/>Review agents]
	ReviewPhase --> DedupPhase[Phase 3<br/>Deduplicate]
	DedupPhase --> Score[Phase 4<br/>Score findings]
	Score --> Report[Review report]

	subgraph ReviewAgents[Review agents phase<br/>Runs concurrently]
		Reviewer[Review session] --> Submit[Submit finding]
		Submit --> Verifier[Verifier session]
		Verifier --> Edit[Edit or invalidate finding]
	end

	ReviewPhase --> Reviewer
	ReadTools[Repository read tools] --> Reviewer
	ReadTools --> Verifier

	subgraph Deduplication[Deduplicate phase]
		DedupSession[Deduplicator session]
		DedupSession --> Merge[Merge findings]
	end

	DedupPhase --> DedupSession

	Report --> Output[Findings, errors,<br/>and telemetry]
```

<!-- BEGIN GENERATED ENVIRONMENT VARIABLES -->

## Environment variables

Workflow-specific variables are discovered from `cleanEnv` schemas in this workflow.

| Environment variable | Type | Default | Choices | Description |
| --- | --- | --- | --- | --- |
| `GIT_DIFF_PATH` | `str` | `—` | `—` | The path to the git diff file. |
| `REVIEW_MODE` | `str` | `multi` | `multi, single` | The review architecture. multi runs the specialized review agents, single runs one generalist agent. |

<!-- END GENERATED ENVIRONMENT VARIABLES -->