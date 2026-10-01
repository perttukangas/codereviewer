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

- `report.json` the review workflow output
- `matches.json` the human-authored mapping from purpose id to reported finding id

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
        "title": "Short description of the intended issue",
        "expectedFiles": ["services/server/src/routes/v1/user/index.ts"],
        "expectedLines": [82, 90]
      }
    ]
  }
}
```

Required purpose fields are `id`, `mainAgent`, `severity`, and `confidence`.
Optional fields are `title`, `expectedFiles`, and `expectedLines`. The optional
fields help a human match reported findings to purposes.

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
5. Run the review with `npm run fixtures:run -- T01`.
6. Author `matches.json` by mapping each purpose id to the reported finding id.
7. Compute metrics with `npm run evaluate:fixtures`.

The scratch clone lives in `tmp/fixture-work/` and is removed after capture. The
submodule is never modified.
