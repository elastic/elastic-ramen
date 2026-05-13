---
name: elastic-cli-usage
description: >
  Use when invoking the elastic CLI via elastic_cli or choosing CLI vs MCP/native
  Kibana tools. Covers shorthands, serverless gotchas, command names, and docs/ESQL flags.
metadata:
  version: 0.3.0
  visibility: public
---

# Skill: elastic-cli-usage (verified gotchas)

Use `elastic_cli` tool for all CLI operations — credentials are injected automatically.
The `elastic` binary is NOT on PATH in the shell environment; never use bash for this.

For anything not listed here, run `es <namespace> --help` or `kb <namespace> --help`.

---

## Shorthands

`es` = `stack es`, `kb` = `stack kb`. Both work.

---

## Prefer MCP/native tools over CLI

| Task | Prefer instead |
|------|---------------|
| ES\|QL queries | `eab_platform_core_execute_esql` |
| Index/datastream listing | `eab_platform_core_list_indices` |
| Streams | `eab_platform_streams_*` |
| Agent builder | `kibana_list_agents`, `kibana_list_tools` |

---

## Gotchas

### Serverless: many cluster APIs return 410

These all fail on serverless with "not available in serverless mode":

- `es cluster health` / `stats` / `get-settings`
- `es ilm get-lifecycle` / `get-status`

Use `es cat count --json` to verify connectivity on serverless instead.

### `es indices list` does not exist

Use `es indices get --index "*" --json` or `es indices get-data-stream --json`.

### `es cluster health-report` does not exist

The subcommand is `es cluster health`. There is no `health-report`.

### Agent builder subcommands use verbose REST-style names

`kb agent-builder agents list` and `tools list` do **not** exist. Real commands:

```
kb agent-builder get-agent-builder-agents --json
kb agent-builder get-agent-builder-tools --json
```

Pattern: `<http-method>-<resource-path>` throughout all of `kb`.

### `docs search` and `docs read` require named flags, not positional args

```
# WRONG — "too many arguments" error
docs search "index lifecycle management"
docs read https://www.elastic.co/...

# CORRECT
docs search --query "index lifecycle management"
docs read --path "https://www.elastic.co/docs/..."
```

Also: old `/guide/` URLs return `(no output)`. Use `elastic.co/docs/` URLs.

### `es esql query` requires `--query` flag, not positional

```
# WRONG
es esql query "FROM logs-* | LIMIT 1"

# CORRECT
es esql query --query "FROM logs-* | LIMIT 1" --json
```

### `kb slo find-slos-op` requires `--space-id`

Omitting it returns a validation error. Use `--space-id default`.

### `--output-fields` and `--output-template` are per-subcommand flags (placed at end)

They are listed as global flags in the help but must come after the full subcommand.
`--output-fields` returns `{}` for array responses — unreliable, avoid it.
`--output-template` only works for top-level scalar fields.
Just use `--json` and process the output.

### Never block on stdin

Never use `--input-file /dev/stdin` or `es helpers watch`. These block forever
and hang the `elastic_cli` tool with no way to cancel.
