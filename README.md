# Code reviewer

LLM based code reviewer for merge requests.

## Environment variables

Defined in file [shared/env.ts](./src/shared/env.ts). Per agent overrides are
resolved in [engine/agent-config.ts](./src/engine/agent-config.ts) using the
uppercased agent id as a prefix, for example `MAINTAINABILITY_TIMEOUT_MS`. Each agent
can be disabled with `<AGENT>_ENABLED=false`, for example `VERIFIER_ENABLED=false`.

## Project structure

```
src/
  index.ts        bin shim
  cli/            argv parsing and one module per command
  workflows/      one folder per capability (vertical slices) plus the registry
    review/       the code review workflow (agents, prompt, tools, report)
    ...
  engine/         workflow-agnostic agent engine (guardrails, config, prompt, tools)
  runtime/        LLM runtime port plus the pi adapter
  integrations/   external systems (ports plus adapters)
  shared/         cross-cutting infrastructure (env, logger)
```
