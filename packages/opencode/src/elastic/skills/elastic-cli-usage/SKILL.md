---
name: elastic-cli-usage
description: >
  Use this skill when invoking the elastic CLI or deciding whether to use
  MCP tools vs the CLI. Activate when using the elastic_cli tool or deciding
  how to query Elasticsearch / Kibana.
metadata:
  version: 0.2.0
  visibility: public
---

# Elastic CLI Usage

## Tool Priority

**Always prefer MCP tools and native Kibana tools over the CLI when available.**
The `eab` MCP server and built-in `kibana_*` tools are faster and return structured data.
Use `elastic_cli` only as a fallback for operations not covered by those tools.

| Task | Prefer |
|------|--------|
| ES\|QL queries | `eab` MCP tool |
| Index / data-stream listing | `eab` MCP tool |
| Cluster health | `elastic_cli` with `es cluster health --json` |
| Docs lookup | `elastic_cli` with `docs search "<query>"` |

---

## elastic_cli Tool

Use the `elastic_cli` tool for all elastic CLI operations. It calls the TypeScript
elastic CLI directly — no subprocess, no PATH issues, credentials injected automatically.

### Command Structure

The top-level subcommands are:

- `stack es <operation>` — Elasticsearch API operations
- `stack kb <operation>` — Kibana API operations
- `cloud <operation>` — Elastic Cloud management
- `docs <operation>` — Documentation search and read

The shorthands `es` and `kb` are accepted as aliases for `stack es` / `stack kb`.

### Common Commands

```
es cluster health --json
es cluster info --json
es indices list --json
stack kb agent-builder agents list --json
stack kb agent-builder tools list --json
docs search "index lifecycle management"
docs read https://www.elastic.co/guide/...
```

Always append `--json` when you need machine-readable output for further processing.

### Output Flags

- `--json` — machine-readable JSON output
- `--output-fields <list>` — comma-separated dot-notation fields to include
- `--output-template <string>` — Mustache-like template, e.g. `"{{name}}: {{status}}"`

### API Availability Notes

Some APIs are only available on stateful (self-managed / hosted) deployments, not
on serverless projects. When a command returns a 404 or "not available" response,
try the equivalent MCP tool or a different API path for serverless.
