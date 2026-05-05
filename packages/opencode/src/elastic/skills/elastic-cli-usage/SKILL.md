---
name: elastic-cli-usage
description: >
  Use this skill when invoking the elastic CLI or deciding whether to use
  MCP tools vs the CLI. Activate when using elastic es raw, elastic kb raw,
  or any other elastic CLI subcommand via the bash tool.
metadata:
  version: 0.1.0
  visibility: public
---

# Elastic CLI Usage

## Tool Priority

**Always prefer MCP tools and native Kibana tools over the CLI when available.**
The `eab` MCP server and built-in `kibana_*` tools are faster and return structured data.
Use the CLI only as a fallback for operations not covered by those tools.

| Task | Prefer |
|------|--------|
| ES|QL queries | `eab` MCP tool or `elastic es query` |
| Index/data-stream listing | `eab` MCP tool |
| Cluster health | `elastic es cluster health` |
| Raw Elasticsearch API | `elastic es raw <path>` |
| Raw Kibana API | `elastic kb raw <path>` |
| Docs lookup | `elastic docs search` / `elastic docs read` |

---

## `elastic es raw` — correct syntax

```
elastic es raw <path> [flags]
```

The **first positional argument is the URL path only** — no method, no leading slash required (it is added automatically).
Method defaults to GET; override with `-X`.

### ✅ Correct

```bash
# GET root info
elastic es raw / --format json

# GET a specific index
elastic es raw my-index --format json

# GET with query params
elastic es raw _cat/indices -q format=json --format json

# POST with a body
elastic es raw _search -X POST -d '{"query":{"match_all":{}},"size":5}' --format json

# PUT to create/update
elastic es raw my-index -X PUT -d '{"settings":{"number_of_shards":1}}' --format json

# DELETE
elastic es raw my-index -X DELETE --format json

# Custom header
elastic es raw _search -X POST -H 'Content-Type:application/json' -d '{"size":0}' --format json
```

### ❌ Common mistakes

```bash
# WRONG — do not put the method as a positional arg
elastic es raw GET /               # "GET" is interpreted as the path
elastic es raw GET ""              # "" becomes the path, GET becomes the index name

# WRONG — do not wrap the path in quotes unless it contains spaces
elastic es raw "GET /"             # treated as a path literal

# WRONG — key=value positional args are not query params
elastic es raw _cat/indices format=json   # parse error
```

---

## `elastic kb raw` — correct syntax

Same pattern as `es raw` but targets the Kibana API. Paths must start with `/api/` or `/internal/`.

```bash
# Kibana status
elastic kb raw /api/status --format json

# List alerting rules (with query params)
elastic kb raw /api/alerting/rules/_find -q per_page=10 --format json

# POST to Kibana API
elastic kb raw /api/saved_objects/_find -X POST \
  -d '{"type":"dashboard"}' --format json
```

---

## Other useful commands

```bash
# ES|QL query (preferred over es raw _search)
elastic es query 'FROM logs-* | WHERE @timestamp > NOW() - 1 HOUR | LIMIT 10'

# Cluster info (works on serverless)
elastic es raw / --format json

# List indices
elastic es indices list
elastic es raw _cat/indices -q format=json --format json

# Data streams
elastic es data-streams list

# Cluster health (stateful only — not available on serverless)
elastic es cluster health

# Kibana dashboards
elastic kb dashboard list
```

---

## Flags reference

| Flag | Description |
|------|-------------|
| `-X METHOD` | HTTP method (default: GET) |
| `-d 'body'` | Request body (sets Content-Type: application/json automatically) |
| `-q key=value` | Add a query parameter (repeatable) |
| `-H 'Key:Value'` | Add a request header (repeatable) |
| `--format json` | Output as JSON (use for machine-readable results) |
| `--format table` | Human-readable table (default) |

---

## Serverless vs stateful

Some Elasticsearch APIs are unavailable on Elastic Cloud Serverless (e.g. `_cluster/health`, `_cluster/stats`, `_nodes`). On serverless, use:
- `elastic es raw / --format json` for version/cluster info
- `elastic es raw _cat/indices -q format=json --format json` for index listing
- ES|QL for all data queries
