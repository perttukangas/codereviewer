# Code reviewer test fixtures

This folder holds the ground-truth fixtures used to evaluate the review agents.
Each fixture is a synthetic diff applied to the `fullstack-harjoitustyo` submodule
plus a `manifest.json` that declares the findings the diff is meant to contain.

The legacy `fixtures/diffs/simple-test/` fixture is kept as a smoke test and is
excluded from evaluation.

## What is a finding?

A finding is one issue a review agent should report for a diff. Every finding has

- an id, written as `Txx-Fyy`
- one main target agent
- an expected severity
- an expected confidence

A finding has exactly one main target. Other agents may also detect the same issue.
That is acceptable and is not penalized. The manifest only declares the main target.

## Difficulty levels

Difficulty describes how hard the issue is to spot. It is separate from severity,
which describes how much impact the issue has. A harder issue can still be critical.

### Easier

- The whole problem is visible in one part of the diff.
- You do not need to open any other file to confirm it.
- There is one obvious correct fix.
- Expected confidence 0.8 or higher.
- Expected severity HIGH or CRITICAL, or a clear MEDIUM.

### Medium

- The problem is visible in the diff, but you must open at least one other file,
  or know how the framework behaves, to confirm the impact.
- Expected confidence between 0.5 and 0.8.
- Expected severity MEDIUM or HIGH.

### Harder

- The problem needs reasoning across several files or a subtle interaction, such
  as concurrency, a transaction boundary, an authorization gap, or a hidden N+1
  query.
- The code looks correct at a glance.
- Expected confidence between 0.5 and 0.8.

## Severity and confidence

Severity and confidence come from the system rubric in
`src/workflows/review/shared/prompt.ts`.

- Severity values are CRITICAL, HIGH, MEDIUM, LOW, and INFO.
- Confidence values are 1.0 for direct evidence, 0.8 for strong evidence, 0.5 for
  plausible, and 0.2 for speculative.

Severity ranges overlap between difficulty levels on purpose. Difficulty is about
how hard the issue is to find. Severity is about how much it matters.

## Folder layout

```
test/fixtures/diffs/
  simple-test/            legacy smoke test, excluded from evaluation
  easier/T01..T05/        one folder per test
  medium/T06..T10/
  harder/T11..T15/
```

Each test folder contains

- `review.diff` the synthetic diff
- `manifest.json` the declared findings

Evaluation output lives in `test/fixtures/results/Txx/` and contains

- `report.multi.json` the multi-agent review workflow output
- `report.single.json` the single-agent review workflow output
- `matches.multi.json` the human-authored mapping for the multi-agent run
- `matches.single.json` the human-authored mapping for the single-agent run
- `logs.multi/` and `logs.single/` the run logs for each mode, each holding
  `combined.log` plus one `<agentId>.log` per agent. Set the `LOG_DIR` environment
  variable to send all runs to a single directory instead.

A `matches.json` value may reference either a source finding id (for example
`correctness-1`) or a merged finding id (for example `deduplicator-1`). When the
deduplicator merges findings, the source findings are removed from their agent
arrays and the merged finding records them in `mergedFindingIds`. Evaluation
follows these merges, so a match to a source id still resolves to the merged
finding and credits the agents listed in `mergedFrom`.

## Review modes

The review workflow runs in one of two modes, selected with the `REVIEW_MODE`
environment variable.

- `multi` (default) runs the five specialized review agents (correctness,
  maintainability, performance, reliability, security) concurrently. Each agent
  is verified by its own verifier.
- `single` runs one generalist agent that covers every review scope. The
  generalist submits each finding with a `scope` array naming the review scopes
  the finding belongs to. The generalist is verified by a verifier.

Both modes run the same deduplication and scoring phases, so the two modes can be
compared directly. The fixture runner runs both modes for every test.

In `single` mode the report key is `generalist`. Main-target recall is computed
from each finding's `scope` array instead of the detecting agent id, so a finding
counts toward the main target when its scope includes the purpose's main agent.

## Manifest schema

```json
{
  "id": "T01",
  "repository": "fullstack-harjoitustyo",
  "revision": "757891693c61990afd973107389a60902e96de7d",
  "difficulty": "easier",
  "diff": {
    "path": "review.diff",
    "changedFiles": ["services/server/src/routes/v1/user/index.ts"],
    "purposes": [
      {
        "id": "T01-F01",
        "mainAgent": "correctness",
        "severity": "HIGH",
        "confidence": 0.8,
        "score": 7.84,
        "title": "Short description of the intended issue",
        "expectedFiles": ["services/server/src/routes/v1/user/index.ts"],
        "expectedLines": [82, 90]
      }
    ]
  }
}
```

Required purpose fields are `id`, `mainAgent`, `severity`, `confidence`, and
`score`. Optional fields are `title`, `expectedFiles`, and `expectedLines`. The
optional fields help a human match reported findings to purposes.

`score` is the expected base score for the finding, computed as
`round2(severityWeight * confidence * agentWeight(mainAgent))` using the weights
in `src/workflows/review/phases/score.ts`. It is the score before merge
amplification, so it does not depend on how many agents detect the finding. Do
not hand-write it. Run `npm run fixtures:scores:write` to compute and write it,
and `npm run fixtures:scores` to verify it.

## ID registry

Each difficulty has five tests. Each test omits one agent on a rotating basis, so
every agent appears in exactly four tests per difficulty. Each test declares four
findings, one per agent present.

| Test | Difficulty | Main targets                                              |
| ---- | ---------- | --------------------------------------------------------- |
| T01  | easier     | correctness, maintainability, performance, reliability    |
| T02  | easier     | correctness, maintainability, performance, security       |
| T03  | easier     | correctness, maintainability, reliability, security       |
| T04  | easier     | correctness, performance, reliability, security           |
| T05  | easier     | maintainability, performance, reliability, security       |
| T06  | medium     | correctness, maintainability, performance, reliability    |
| T07  | medium     | correctness, maintainability, performance, security       |
| T08  | medium     | correctness, maintainability, reliability, security       |
| T09  | medium     | correctness, performance, reliability, security           |
| T10  | medium     | maintainability, performance, reliability, security       |
| T11  | harder     | correctness, maintainability, performance, reliability    |
| T12  | harder     | correctness, maintainability, performance, security       |
| T13  | harder     | correctness, maintainability, reliability, security       |
| T14  | harder     | correctness, performance, reliability, security           |
| T15  | harder     | maintainability, performance, reliability, security       |

## Coverage target

Across all tests each agent accumulates four easier, four medium, and four harder
findings. That is twelve findings per agent and sixty findings in total.

## Workflow

1. Prepare a scratch clone with `npm run fixtures:prepare -- T01`.
2. Edit the files in the scratch clone to introduce the intended findings.
3. Capture the diff with `npm run fixtures:capture -- T01 easier`.
4. Write `manifest.json` for the test.
5. Run the review with `npm run fixtures:run -- T01`. This runs both the
   `multi` and `single` modes and writes `report.multi.json` and
   `report.single.json`. Pass a mode first to run only one, for example
   `npm run fixtures:run -- single T01`.
6. Author `matches.multi.json` and `matches.single.json` by mapping each purpose
   id to the reported finding id in each mode.
7. Compute metrics with `npm run evaluate:fixtures`.

The scratch clone lives in `tmp/fixture-work/` and is removed after capture. The
submodule is never modified.

## Evaluation metrics

`npm run evaluate:fixtures` writes `results/summary.md` and `results/summary.json`.
For each purpose it reports recall, main-target recall, and the error between the
declared and reported values. Metrics are reported per mode so the multi-agent and
single-agent runs can be compared directly.

- `severityError` is the distance in severity ranks between the declared and
  reported severity.
- `confidenceError` is the absolute difference between the declared and reported
  confidence.
- `baseScoreError` is the primary score metric. It compares the declared `score`
  against the base score recomputed from the reported finding
  (`severity * confidence * agentWeight`), so it is independent of how many agents
  detected the finding. In `single` mode the weight is the most severe weight
  among the finding's `scope` values.
- `scoreError` compares the declared `score` against the reported final `score`.
  The declared `score` is multiplied by the merge factor (the number of distinct
  detecting agents, capped at 3) so the comparison accounts for merge
  amplification.
- The telemetry section compares duration and total token usage between the two
  modes per test.
