# Elastic RAMEN 🍜

**R**oot-cause **A**nalysis & **M**onitoring **En**gine

An Elastic-specific fork of [OpenCode](https://github.com/anomalyco/opencode) — the open-source AI coding agent — extended with native Kibana/Elasticsearch integration for SRE and observability workflows.

![Elastic RAMEN](./images/ramen.png)

> **EXPERIMENTAL** — This tool is highly experimental. No guarantees are offered. Use at your own risk.

---

## Prerequisites

You need an Elastic Observability Serverless project. In Kibana, open **Stack Management** → **Advanced Settings**, or go directly to `https://<your-kibana-url>/app/management/kibana/settings?query=ramen`, and enable **`elasticRamen:enabled`**.

## Installation

Install globally with the package manager of your choice:

```bash
npm  i   -g @elastic/ramen
pnpm add -g @elastic/ramen
yarn global add @elastic/ramen
bun  add -g @elastic/ramen
```

Or use the install script:

```bash
curl -fsSL https://raw.githubusercontent.com/elastic/elastic-ramen/dev/install | bash
```

Or download a pre-built binary from [GitHub Releases](https://github.com/elastic/elastic-ramen/releases).

After installation, run:

```bash
elastic-ramen --kibana-base=https://<your-kibana-url>
```

## Getting Started

### Quick start

Run the CLI:

```bash
elastic-ramen
```

On first launch (or when no Kibana connection is configured), RAMEN will prompt you to enter your Kibana URL. This starts the Kibana callback auth flow — open the link in your browser, click **Generate credentials**, and Kibana will automatically deliver your credentials.

Alternatively, pass the Kibana URL directly:

```bash
elastic-ramen --kibana-base=http://localhost:5601
```

You can also use `/connect` inside the TUI at any time to (re)configure the Kibana connection.

For one-shot, headless usage (no TUI), pass `-p` / `--prompt`:

```bash
elastic-ramen -p "list my services"
```

The CLI runs the prompt through the `run` command and exits.

### What happens during auth

The auth flow writes:

1. **Elastic credentials** in the elastic CLI config file (same path the Go CLI uses: macOS `~/Library/Application Support/elastic/config.yaml`, Linux `~/.config/elastic/config.yaml` or `$XDG_CONFIG_HOME/elastic/config.yaml`, Windows `%AppData%\elastic\config.yaml`) with `elasticsearch_url`, `kibana_url`, `api_key`
2. **Provider + permissions** to `elastic_ramen.json` in the current working directory:
   - `provider.kibana` — Kibana LLM Gateway (OpenAI-compatible)
   - `permission.eab_*: "allow"` — auto-allow Agent Builder MCP tools (the `eab` MCP client is wired at runtime to Kibana's `/api/agent_builder/mcp` when your Elastic profile includes `kibana_url` and `api_key`; no `elastic ab mcp proxy` process)

After saving, the TUI re-bootstraps to pick up the new config immediately.

### Manual config

You can skip the dialog entirely by writing the config files yourself:

```yaml
# e.g. ~/.config/elastic/config.yaml on Linux; ~/Library/Application Support/elastic/config.yaml on macOS
current-context: default
contexts:
  default:
    cloud_id: "my-deployment:base64..."   # or elasticsearch_url: "https://..."
    kibana_url: "https://my-kibana.kb.cloud:443"
    api_key: "your-api-key"
```

For headless commands (`elastic-ramen run`, `elastic-ramen serve`), the config file must exist before launch.

### Resetting auth

```bash
elastic-ramen --reset-auth
```

This removes stored credentials from the elastic config file (platform-specific user config dir + `/elastic/config.yaml`) and clears `provider`/`model` from `elastic_ramen.json`. The setup dialog will show on next launch.

### Importing config from other AI tools

If you already have MCP servers, rules, or skills configured in another AI harness, import them into `elastic_ramen.json`:

```bash
elastic-ramen import-from claude          # Claude Code
elastic-ramen import-from cursor          # Cursor
```

Imports MCP servers (converted to RAMEN format), instruction file paths, and skill directory paths. Re-runnable — already-imported items are skipped.

### API key requirements

The API key needs privileges for cluster health, data streams, Kibana APIs, and alert polling (`.alerts-*` indices).

Create the key via the Elasticsearch Dev Tools console or API:

```
POST /_security/api_key
{
  "name": "elastic-ramen",
  "expiration": "30d",
  "role_descriptors": {
    "elastic-ramen": {
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

RAMEN uses the Kibana LLM Gateway as its model provider. The Kibana plugin exposes an OpenAI-compatible API that routes through Kibana-configured AI connectors. This is configured automatically during the auth flow.

The provider uses the internal Kibana API at `/internal/elastic_ramen/v1/chat/completions` with required headers:

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

If you didn't use the auth flow, you can manually add the provider to `elastic_ramen.json`:

```json
{
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
        "baseURL": "https://my-kibana:5601/internal/elastic_ramen/v1",
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

## Agents

RAMEN ships with two built-in agents:

- **Investigate** (default) — The primary agent for investigating issues, running tools, and making changes based on configured permissions.
- **Plan** — Research and planning mode. Disallows edit tools. Use for scoping work before executing.

Press `Tab` to cycle between agents, or use `@agent-name` in prompts.

---

## MCP Server (Elastic Agent Builder)

The `eab` MCP tools connect to **Kibana's Agent Builder MCP HTTP endpoint** (`POST /api/agent_builder/mcp`) using the same API key and Kibana URL as your Elastic CLI profile. RAMEN applies this at config load time; you do not run `elastic ab mcp proxy`.

Tools from the MCP server are prefixed with `eab_` and auto-allowed via `permission.eab_*: "allow"` in `elastic_ramen.json` (written during auth).

### Elastic CLI

The `elastic` CLI binary is embedded in the build and available on PATH at runtime. It uses the same credentials file as RAMEN (`UserConfigDir/elastic/config.yaml` — see paths above). Key commands:

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

Sessions are automatically synced to Kibana as conversations. When a session transitions from busy to idle, the conversation rounds (user messages, assistant responses, tool calls) are pushed to the Kibana conversations API at `/internal/elastic_ramen/conversations`.

> **Note:** If conversation storage hasn't been initialized in Kibana yet, RAMEN will show a one-time info message. Start a conversation in the Agent Builder UI first to initialize storage.

### Kibana Conversation Takeover

Use the `/kibana-conversations` command (or `/kibana-takeover`) to continue a conversation started in Kibana Agent Builder. The dialog lists remote conversations and imports their history into a new local session.

---

## Native Kibana Tools

20 built-in tools for interacting with Kibana APIs directly (no MCP server required):

- **Workflows**: `kibana_list_workflows`, `kibana_get_workflow`, `kibana_create_workflow`, `kibana_update_workflow`, `kibana_delete_workflow`, `kibana_validate_workflow`, `kibana_run_workflow`, `kibana_get_execution`, `kibana_list_executions`
- **Agent Builder Tools**: `kibana_list_tools`, `kibana_get_tool`, `kibana_create_tool`, `kibana_update_tool`, `kibana_delete_tool`
- **Agent Builder Agents**: `kibana_list_agents`, `kibana_get_agent`, `kibana_create_agent`, `kibana_update_agent`, `kibana_delete_agent`
- **Connectors**: `kibana_list_connectors`

---

## Built-in Elastic Skills

Three domain-specific skills bundled under `src/elastic/skills/`:

- **elasticsearch-esql** — ES|QL query patterns and best practices
- **observability-rca** — Root cause analysis workflow for incidents
- **slo-management** — SLO creation and management guidance

---

## Chart Tool

Terminal-based chart rendering (`chart` tool) for visualizing ES|QL query results with Unicode bar charts.

## Elastic Alerts

Live active-alert polling from Elasticsearch (`.alerts-*` indices), surfaced in the TUI sidebar.

---

## Building

```bash
cd packages/opencode && bun run build
```

---

## Upstream

Based on [OpenCode](https://github.com/anomalyco/opencode). See the upstream repo for general configuration, agent docs, and provider setup.

---

## License

MIT License — Copyright (c) 2026-present, Elastic NV

This project is based on [opencode](https://github.com/anomalyco/opencode) by anomalyco, used under the MIT License.

See [LICENSE](./LICENSE) and [NOTICE](./NOTICE) for details.
