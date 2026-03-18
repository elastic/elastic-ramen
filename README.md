# Elastic Console

An Elastic-specific fork of [OpenCode](https://github.com/anomalyco/opencode) — the open-source AI coding agent — extended with native Kibana/Elasticsearch integration for SRE and observability workflows.

---

## Getting Started

### Option A: Manual setup (default)

Run the TUI with no flags:

```bash
elastic-console
```

The onboarding dialog shows two fields:

- **Cloud ID or Elasticsearch URL** — enter a Cloud ID (`my-deployment:dXMtY2Vud...`) or a full URL (`https://my-cluster.es.cloud:443`)
- **API Key** — an Elasticsearch API key

Press `Tab` to switch between fields and `Ctrl+Enter` to connect.

When a Cloud ID is provided, the Kibana URL is derived automatically and the **LLM Gateway provider** is configured — so you can start chatting immediately without a separate LLM API key.

### Option B: One-click Kibana setup (experimental)

```bash
elastic-console --kibana-base=http://localhost:5601
```

This starts a local callback server and shows a Kibana onboarding link. Open the link in your browser, click **Generate credentials**, and Kibana will automatically deliver:

- Elasticsearch URL + API key (saved to `~/.config/elastic/config.yaml`)
- **LLM Gateway provider** — routes model requests through Kibana's AI connectors via an OpenAI-compatible proxy at `/internal/elastic_console/v1`

You can also click **"Or enter credentials manually"** to fall back to the two-field form.

### What happens during auth

The auth flow writes:

1. **Elastic credentials** to `~/.config/elastic/config.yaml` (elasticsearch_url, kibana_url, api_key)
2. **Provider + MCP + permissions** to `elastic_console.json` in the current working directory:
   - `provider.kibana` — Kibana LLM Gateway (OpenAI-compatible)
   - `mcp.eab` — Elastic Agent Builder MCP server (`elastic ab mcp proxy`)
   - `permission.eab_*: "allow"` — auto-allow MCP tools

After saving, the server-side instance is disposed and the TUI re-bootstraps to pick up the new config immediately.

### Manual config

You can skip the dialog entirely by writing the config files yourself:

```yaml
# ~/.config/elastic/config.yaml
current-context: default
contexts:
  default:
    cloud_id: "my-deployment:base64..."   # or elasticsearch_url: "https://..."
    kibana_url: "https://my-kibana.kb.cloud:443"
    api_key: "your-api-key"
```

For headless commands (`elastic-console run`, `elastic-console serve`), the config file must exist before launch.

### Resetting auth

```bash
elastic-console --reset-auth
```

This removes stored credentials from `~/.config/elastic/config.yaml` and clears `provider`/`model` from `elastic_console.json`. The setup dialog will show on next launch.

### API key requirements

The API key needs privileges for cluster health, data streams, Kibana APIs, and alert polling (`.alerts-*` indices).

Create the key via the Elasticsearch Dev Tools console or API:

```
POST /_security/api_key
{
  "name": "elastic-console",
  "expiration": "30d",
  "role_descriptors": {
    "elastic-console": {
      "cluster": ["all"],
      "indices": [
        {
          "names": ["*"],
          "privileges": ["all"],
          "allow_restricted_indices": true
        }
      ],
      "applications": [
        {
          "application": "*",
          "privileges": ["*"],
          "resources": ["*"]
        }
      ]
    }
  }
}
```

Use the `encoded` value from the response as your API key.

---

## LLM Gateway

The Kibana plugin at `x-pack/platform/plugins/shared/elastic_console/` exposes an OpenAI-compatible API that routes through Kibana-configured AI connectors. When using the auth flow (either manual with Cloud ID or one-click Kibana setup), this is configured automatically.

The provider uses the internal Kibana API at `/internal/elastic_console/v1/chat/completions` with required headers:

- `Authorization: ApiKey <base64-encoded-key>`
- `kbn-xsrf: true`
- `x-elastic-internal-origin: kibana`
- `elastic-api-version: 2023-10-31`

### What works

- Chat completions (streaming and non-streaming)
- Tool/function calling
- Multi-turn conversations
- Any connector configured in Kibana (the `"default"` model ID resolves to the default inference connector)

### What doesn't work (yet)

- **Attachments / image content** — the provider is configured with `attachment: false`
- **Reasoning / extended thinking** — configured with `reasoning: false`
- **Multiple models** — only a single `"default"` model is registered; you cannot select specific connectors by name from the TUI
- **Token usage tracking** — cost is set to `0` since tokens are metered on the Kibana/connector side

### Manual LLM Gateway setup

If you didn't use the auth flow, you can manually add the provider to `elastic_console.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "kibana": {
      "name": "Kibana LLM Gateway",
      "id": "kibana",
      "npm": "@ai-sdk/openai-compatible",
      "env": [],
      "models": {
        "default": {
          "id": "default",
          "name": "Default Connector",
          "attachment": false,
          "reasoning": false,
          "temperature": true,
          "tool_call": true,
          "release_date": "2025-01-01",
          "cost": { "input": 0, "output": 0 },
          "limit": { "context": 128000, "output": 8192 }
        }
      },
      "options": {
        "baseURL": "https://my-kibana:5601/internal/elastic_console/v1",
        "apiKey": "ignored",
        "headers": {
          "Authorization": "ApiKey <your-base64-encoded-api-key>",
          "kbn-xsrf": "true",
          "x-elastic-internal-origin": "kibana",
          "elastic-api-version": "2023-10-31"
        }
      }
    }
  },
  "model": "kibana/default"
}
```

The `apiKey` field is required by the AI SDK but ignored — actual auth is via the `Authorization` header.

---

## MCP Server (Elastic Agent Builder)

The `eab` MCP server provides additional Elasticsearch capabilities (ES|QL queries, index operations, documentation search) through the `elastic ab mcp proxy` command. It is configured automatically during the auth flow.

Tools from the MCP server are prefixed with `eab_` and auto-allowed via `permission.eab_*: "allow"` in `elastic_console.json`.

### Elastic CLI

The `elastic` CLI binary is embedded in the build and available on PATH at runtime. It uses the same credentials from `~/.config/elastic/config.yaml`. Key commands:

- `elastic es query "<ESQL>"` — run an ES|QL query
- `elastic es raw <method> <path> [-d '<body>']` — raw Elasticsearch HTTP requests
- `elastic es indices list` — list indices
- `elastic es data-streams list` — list data streams
- `elastic es cluster health` — check cluster health
- `elastic kb raw <method> <path> [-d '<body>']` — raw Kibana HTTP requests
- `elastic docs search "<query>"` — search Elastic documentation
- `elastic docs read <url>` — read an Elastic docs page
- `elastic slos list` — list SLOs

Use `--format json` for machine-readable output. Use `elastic <command> --help` for full options.

---

## Conversation Sync

Sessions in elastic-console are automatically synced to Kibana as conversations. When a session transitions from busy to idle, the conversation rounds (user messages, assistant responses, tool calls) are pushed to the Kibana conversations API at `/internal/elastic_console/conversations`.

### Kibana Conversation Takeover

Use the `/kibana-conversations` command (or `/kibana-takeover`) to continue a conversation started in Kibana Agent Builder. The dialog lists remote conversations and imports their history into a new local session.

---

## What's changed from OpenCode

### Branding & CLI

- Renamed CLI from `opencode` to `elastic-console`
- Config file: `elastic_console.json` (searched first, falls back to `opencode.json`)
- Custom ASCII logo using Elastic brand colors

### Elastic Authentication

- Two-mode onboarding: manual Cloud ID + API Key (default) or Kibana callback (experimental, with `--kibana-base`)
- Credentials stored in `~/.config/elastic/config.yaml`
- `--reset-auth` CLI flag to clear stored credentials
- Auth flow writes provider, MCP, and permissions to `elastic_console.json`

### Native Kibana Tools

20 built-in tools for interacting with Kibana APIs directly (no MCP server required):

- **Workflows**: `kibana_list_workflows`, `kibana_get_workflow`, `kibana_create_workflow`, `kibana_update_workflow`, `kibana_delete_workflow`, `kibana_validate_workflow`, `kibana_run_workflow`, `kibana_get_execution`, `kibana_list_executions`
- **Agent Builder Tools**: `kibana_list_tools`, `kibana_get_tool`, `kibana_create_tool`, `kibana_update_tool`, `kibana_delete_tool`
- **Agent Builder Agents**: `kibana_list_agents`, `kibana_get_agent`, `kibana_create_agent`, `kibana_update_agent`, `kibana_delete_agent`
- **Connectors**: `kibana_list_connectors`

### Chart Tool

Terminal-based chart rendering (`chart` tool) for visualizing ES|QL query results with Unicode bar charts.

### Elastic Alerts

Live active-alert polling from Elasticsearch (`.alerts-*` indices), surfaced in the TUI sidebar.

### Built-in Elastic Skills

Three domain-specific skills bundled under `src/elastic/skills/`:

- **elasticsearch-esql** — ES|QL query patterns and best practices
- **observability-rca** — Root cause analysis workflow for incidents
- **slo-management** — SLO creation and management guidance

### System Prompt

Custom SRE-focused system instructions injected into sessions, covering the RCA workflow, available Kibana tools, ES|QL query patterns, and the `elastic` CLI.

---

## Building

```bash
cd packages/opencode && bun run build
```

---

## Upstream

Based on [OpenCode](https://github.com/anomalyco/opencode). See the upstream repo for general configuration, agent docs, and provider setup.
