# Code reviewer

LLM based code reviewer for merge requests.

## Usage

```
codereviewer [command]
```

Commands are thin CLI entry points that map to a workflow. The default command is
`review`.

- `review` — run the code review workflow

Run `codereviewer --help` to list the available commands and registered workflows.

## Environment variables

Defined in file [platform/env.ts](./src/platform/env.ts). Per agent overrides are
resolved in [engine/agent-config.ts](./src/engine/agent-config.ts) using the
uppercased agent id as a prefix, for example `CODE_QUALITY_TIMEOUT_MS`.

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
  platform/       cross-cutting infrastructure (env, logger)
```

## Adding a workflow

1. Create `src/workflows/<id>/` with a `workflow.ts` exporting a `Workflow`.
2. Register it in `src/workflows/registry.ts`.
3. Add a matching command in `src/cli/commands/` and map it in `src/cli/index.ts`.