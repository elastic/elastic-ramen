# Elastic Console on Pi Framework — Migration Spec

This document maps every major subsystem of elastic-console (fork of OpenCode) to its Pi framework equivalent, covering built-in features, community packages, and areas requiring custom development.

## 1. Agent Loop

### Current (OpenCode)
- `packages/opencode/src/session/processor.ts` — main loop controller
- `packages/opencode/src/session/llm.ts` — LLM streaming, system prompt assembly
- Loop: stream → process events → execute tools → feed results back → repeat
- Doom loop detection (3× same tool + same input → ask user)
- Retry logic with exponential backoff on transient errors
- Context compaction when token limits approached

### Pi Equivalent
- **Built-in**: `@mariozechner/pi-agent-core` (`agent-loop.ts`)
- Same nested-loop structure: outer loop for follow-ups, inner loop for tool call cycles
- Completion criteria: `stopReason === "error" | "aborted"`, no pending tool calls, no steering/follow-up messages
- `steer()` injects messages mid-turn; `followUp()` queues work after agent finishes — no direct equivalent in OpenCode

### Migration Notes
- Doom loop detection: implement via `afterToolCall` hook tracking recent (tool, input) pairs
- Retry logic: implement in a wrapper around `agent.prompt()` or in `afterToolCall`
- Context compaction: use the `transformContext()` hook — called before each LLM invocation, can prune/summarize older messages

---

## 2. LLM Providers

### Current (OpenCode)
- `packages/opencode/src/provider/provider.ts` — provider factory, 20+ providers
- `packages/opencode/src/provider/models.ts` — model registry (context window, cost, capabilities)
- `packages/opencode/src/provider/transform.ts` — token counting, cost calculation middleware
- Uses Vercel AI SDK (`@ai-sdk/ai`) as the abstraction layer
- Custom: Kibana LLM Gateway (OpenAI-compatible endpoint)

### Pi Equivalent
- **Built-in**: `@mariozechner/pi-ai` — `getModel('provider', 'model-name')`
- Supports: Anthropic, OpenAI, Google (Vertex + Gemini), Mistral, Groq, xAI, Bedrock, and more
- Only includes models with tool-calling support
- Serializable `Context` objects allow mid-conversation provider switching
- Built-in token and cost tracking

### Migration Notes
- Kibana LLM Gateway: write a custom Pi provider adapter (OpenAI-compatible, so likely wrapping the OpenAI provider with custom base URL + auth headers)
- Model registry: Pi handles this internally per provider; custom model metadata (e.g., Elastic-specific cost tracking) can be layered on top
- The serializable `Context` is a design win — enables provider-hopping and offline persistence natively

---

## 3. Tool System

### Current (OpenCode)
- `packages/opencode/src/tool/registry.ts` — discovery, filtering by model/agent/permissions
- `packages/opencode/src/tool/tool.ts` — `Tool.Info` interface with `init()` → `{ parameters, description, execute }`
- 49 tool implementations across built-in, Kibana-specific, and plugin-loaded tools
- Uses Zod schemas for parameter validation

### Pi Equivalent
- **Built-in tools** (7 total):
  - Default set (`codingTools`): `read`, `write`, `edit`, `bash`
  - Additional (`readOnlyTools` / `allTools`): `grep`, `find`, `ls`
- `AgentTool` interface with TypeBox schemas for parameter validation
- Tools passed via `initialState.tools` array or set dynamically at runtime

### Pi Tool Interface
```typescript
interface AgentTool<TParameters extends TSchema = TSchema, TDetails = any> extends Tool<TParameters> {
  label: string;
  prepareArguments?: (args: unknown) => Static<TParameters>;
  execute: (
    toolCallId: string,
    params: Static<TParameters>,
    signal?: AbortSignal,
    onUpdate?: AgentToolUpdateCallback<TDetails>,
  ) => Promise<AgentToolResult<TDetails>>;
}
```

### Migration Notes
- Built-in coverage: read, write, edit, bash, grep, find (glob), ls — covers ~7 of the 49 tools
- Remaining OpenCode tools to port as custom `AgentTool` implementations (see §10 for full list)
- Schema migration: Zod → TypeBox (structurally similar, mechanical conversion)
- Tool filtering by agent/model: implement in the agent factory that assembles the tools array per agent type

---

## 4. Permission System

### Current (OpenCode)
- `packages/opencode/src/permission/next.ts` — hierarchical rule matching
- Three levels: global defaults → agent-specific → user config overrides
- Actions: allow / deny / ask (prompts user)
- Pattern matching with wildcards on tool names and arguments (e.g., `external_directory: ask`)
- Doom loop permission for repeated tool calls

### Pi Equivalent
- **No built-in permission system**
- Community packages:
  - `pi-permission-system` (v0.3.1) — permission enforcement extension
  - `@aliou/pi-guardrails` (v0.9.5) — security hooks to reduce destructive actions
  - `@grwnd/pi-governance` (v3.0.0) — RBAC, audit logging, human-in-the-loop
- Hook points: `beforeToolCall` and `afterToolCall` on the `Agent` class

### Migration Notes
- Evaluate `pi-permission-system` and `@grwnd/pi-governance` for feature coverage
- If insufficient, implement custom permission logic in `beforeToolCall`:
  ```typescript
  beforeToolCall: async ({ toolCall, args, context }) => {
    const rule = matchRule(toolCall.name, args, agentRuleset);
    if (rule === "deny") return { abort: true, reason: "denied by policy" };
    if (rule === "ask") return await promptUser(toolCall, args);
    return { abort: false };
  }
  ```
- The hierarchical ruleset (global → agent → user) is custom logic regardless of which base package is used

---

## 5. Agent Definitions

### Current (OpenCode)
- `packages/opencode/src/agent/agent.ts` — declarative agent configs
- Pre-configured agents: `build` (primary), `plan` (read-only), `general` (parallel), `explore` (read-only search)
- Properties: name, model, prompt, permission ruleset, temperature, topP, max steps, mode (primary/subagent)

### Pi Equivalent
- Agents are `Agent` class instances with different `initialState` configurations
- No declarative agent definition format — agents are composed in code

### Migration Notes
- Create an agent factory function per agent type:
  ```typescript
  function createPlanAgent() {
    return new Agent({
      initialState: {
        systemPrompt: PLAN_PROMPT,
        model: getModel("anthropic", "claude-sonnet-4-20250514"),
        tools: readOnlyTools,  // grep, find, ls, read
        messages: [],
      },
      toolExecution: "sequential",
    });
  }
  ```
- Sub-agent orchestration: community packages `pi-subagents` or `@tintinweb/pi-subagents` provide Claude Code-style delegation
- Alternatively, manage multiple `Agent` instances manually with message passing

---

## 6. Session Persistence & Message Storage

### Current (OpenCode)
- SQLite via Drizzle ORM (`packages/opencode/src/storage/db.ts`)
- Tables: `sessions`, `messages`, `parts`
- Every tool call, text chunk, reasoning block persisted immediately
- Snapshots track filesystem state before/after each step
- Session compaction on context overflow

### Pi Equivalent
- **Built-in**: JSONL-based session persistence with tree-structured branching
- Sessions support `/resume`, `/tree` navigation, branching
- Community: `pi-context` (v1.1.2) — time-travel and checkpoints; `pi-rewind` (v0.4.1) — per-tool snapshots

### Migration Notes
- Pi's built-in JSONL sessions cover the basic resume/history use case
- If SQLite is needed (e.g., for querying, reporting, multi-client access), build a custom persistence layer using the `AgentEvent` stream:
  - Subscribe to events (`tool_execution_end`, `message_update`, `agent_end`)
  - Write to SQLite with a schema similar to OpenCode's
- Snapshot tracking: evaluate `pi-rewind` for per-tool filesystem snapshots, or implement via `afterToolCall`

---

## 7. MCP (Model Context Protocol) Integration

### Current (OpenCode)
- `packages/opencode/src/mcp/index.ts` — full MCP client
- Transports: stdio (subprocess), SSE, HTTP (StreamableHTTPClientTransport)
- Auto-discovers tools from MCP servers via `server.listTools()`
- Converts MCP tool definitions to AI SDK format
- OAuth flow support for authenticated MCP servers

### Pi Equivalent
- **Community package**: `pi-mcp-adapter` (v2.2.1)
- Also: `@benvargas/pi-exa-mcp` for Exa-specific MCP

### Migration Notes
- Install `pi-mcp-adapter` and evaluate transport support (stdio, SSE, HTTP)
- OAuth flow for MCP servers: likely needs custom work on top of the adapter
- MCP tool → Pi `AgentTool` conversion should be handled by the adapter

---

## 8. Plugin / Extension System

### Current (OpenCode)
- `packages/opencode/src/plugin/index.ts` — dynamic plugin loading
- Plugins are npm packages or local files exporting a function
- Can define: tools, agents, hooks, auth methods
- Discovery via config file: `config.plugin = ["package@version", "file://..."]`

### Pi Equivalent
- **Built-in**: first-class extension system in `pi-coding-agent`
- Extensions loaded from `~/.pi/agent/extensions/`, `.pi/extensions/`, or installed packages
- Built-in package manager: `pi install`, `pi remove`, `pi update`, `pi list`
- Packages distributed via npm (keyword: `pi-package`) or git repos
- Extensions can: register tools, slash commands, keyboard shortcuts, event subscribers, custom UI widgets

### Migration Notes
- Pi's extension system is more mature than OpenCode's plugin system
- Elastic-specific functionality (Kibana tools, auth, alerts) should be packaged as a Pi extension
- Existing OpenCode plugins need porting to Pi extension format (different API surface but similar concepts)

---

## 9. CLI & Terminal UI

### Current (OpenCode)
- CLI: yargs with 26 command files in `packages/opencode/src/cli/cmd/`
- TUI: OpenTUI + Solid.js reactive framework for terminal
- Context providers for state management (SDK, sync, route, theme, keybind)
- Commands: run (headless), tui (interactive), serve (API), acp (Agent Communication Protocol), session management, mcp, github, providers

### Pi Equivalent
- **Built-in**: `@mariozechner/pi-tui` — terminal UI with differential rendering
- **Built-in**: `@mariozechner/pi-web-ui` — web components for chat interfaces
- The coding agent (`pi-coding-agent`) is itself a full CLI with slash commands, themes, keyboard shortcuts

### Migration Notes
- Pi's TUI is purpose-built for agent interaction — likely sufficient for the interactive mode
- Headless mode (`run` command equivalent): use `Agent` class directly without TUI
- API server (`serve` command): would need custom implementation (Pi doesn't ship an HTTP API server)
- ACP (Agent Communication Protocol): would need custom implementation

---

## 10. Tool Inventory — Full Migration Map

### Already Covered by Pi Built-in

| OpenCode Tool | Pi Equivalent | Notes |
|---|---|---|
| `read` | `read` | Default tool |
| `write` | `write` | Default tool |
| `edit` | `edit` | Default tool |
| `bash` | `bash` | Default tool |
| `grep` | `grep` | Enable via `allTools` |
| `glob` | `find` | Enable via `allTools` |
| (directory listing) | `ls` | Enable via `allTools` |

### Available via Community Packages

| OpenCode Tool | Pi Package | Notes |
|---|---|---|
| `webfetch` | `pi-web-access` | URL fetching with HTML→markdown |
| `websearch` | `pi-web-access`, `@aliou/pi-linkup`, `@apmantza/greedysearch-pi` | Multiple options |
| `codesearch` | `@benvargas/pi-exa-mcp` | Via Exa MCP |
| `question` (ask user) | `pi-ask-user` (v0.5.1) | Interactive ask with selection UI |
| `task` (task management) | `@tintinweb/pi-tasks` (v0.4.2) | Task tracking and coordination |
| `agent` (sub-agent spawn) | `pi-subagents`, `@tintinweb/pi-subagents` | Sub-agent delegation |

### Needs Custom Implementation

| OpenCode Tool | Effort | Notes |
|---|---|---|
| `skill` | Low | Pi has built-in Skills (Agent Skills standard) — wire up |
| `notebook_edit` | Medium | Jupyter notebook cell editing |
| `mcp` (dynamic MCP) | Medium | Extend `pi-mcp-adapter` |
| All Kibana tools (~15) | High | Elastic-specific, expected custom work |
| `lsp` | Medium | Language Server Protocol integration |

### Kibana Tools (all custom)

These are Elastic-specific and would be implemented as a Pi extension package:

- `KibanaListWorkflows`, `KibanaGetWorkflow`, `KibanaCreateWorkflow`
- `KibanaListExecutions`, `KibanaGetExecution`, `KibanaRunWorkflow`
- `KibanaListTools`, `KibanaGetTool`, `KibanaCreateTool`
- `KibanaListAgents`, `KibanaCreateAgent`
- `KibanaListConnectors`

---

## 11. Elastic / Kibana Integration

### Current (OpenCode)
- `packages/opencode/src/elastic/auth.ts` — credential management
- `packages/opencode/src/elastic/client.ts` — Elasticsearch client
- `packages/opencode/src/elastic/handover.ts` — Kibana takeover integration
- `packages/opencode/src/elastic/alerts.ts` — alert polling
- Kibana LLM Gateway as a custom provider

### Pi Equivalent
- **No equivalent** — all custom work

### Migration Notes
- Package as a single Pi extension: `elastic-console-pi-extension`
- Extension registers:
  - Kibana tools (see §10)
  - Custom LLM provider (Kibana LLM Gateway)
  - Auth flow (credential delivery, onboarding)
  - Alert polling (via agent event subscription or background process)
  - Handover integration

---

## 12. System Prompt & Configuration

### Current (OpenCode)
- System prompt assembled from: provider defaults + agent prompt + user inline system + plugin hooks
- Config loaded from: `opencode.json`, `.opencode/opencode.json`, env vars, auth plugins
- Provider-specific prompt transforms

### Pi Equivalent
- System prompt: `initialState.systemPrompt` on `Agent` class
- Config: code-level configuration, no JSON config file system
- Prompt templates and skills can be distributed as packages

### Migration Notes
- System prompt assembly: build a prompt builder function that composes the same layers
- Config file support: implement a config loader that reads from project/user directories and maps to Pi agent options
- Or adopt Pi's code-first config approach and use extensions for customization

---

## 13. Web UI & Desktop

### Current (OpenCode)
- `packages/app/` — Solid.js web UI
- `packages/desktop/` — Tauri desktop app
- `packages/desktop-electron/` — Electron variant
- `packages/ui/` — shared UI components

### Pi Equivalent
- **Built-in**: `@mariozechner/pi-web-ui` — web components for chat interfaces
- **Community**: `pi-studio` (v0.5.42) — two-pane browser workspace
- No desktop app

### Migration Notes
- Evaluate `pi-web-ui` and `pi-studio` for web UI needs
- Desktop app: wrap Pi web UI in Tauri/Electron if needed (separate effort)

---

## 14. Additional Systems

### Event Bus
- **Current**: `packages/opencode/src/bus/index.ts` — decoupled event communication
- **Pi**: `AgentEvent` stream with typed lifecycle events (`agent_start`, `turn_start`, `message_update`, `tool_execution_start/end`, `agent_end`). Extensions subscribe to events directly.

### Feature Flags
- **Current**: `packages/opencode/src/flag/flag.ts`
- **Pi**: No built-in equivalent. Implement as a simple module or use environment variables.

### SDK / Client Library
- **Current**: `packages/sdk/js/` — `@opencode-ai/sdk` for programmatic access
- **Pi**: Use `@mariozechner/pi-agent-core` directly for programmatic agent control. No separate client SDK.

### Slack Integration
- **Current**: `packages/slack/`
- **Pi**: `@mariozechner/pi-mom` — built-in Slack bot that delegates to the coding agent.

---

## 15. Summary — Effort Breakdown

| Category | Status | Estimated Effort |
|---|---|---|
| Agent loop | Built-in | — |
| LLM providers | Built-in (+ custom for Kibana Gateway) | Low |
| Core tools (read/write/edit/bash/grep/find/ls) | Built-in | — |
| Session persistence | Built-in (JSONL) | — |
| Extension/plugin system | Built-in | — |
| TUI | Built-in | — |
| Web UI | Built-in (`pi-web-ui`) | Low |
| MCP | Community (`pi-mcp-adapter`) | Low |
| Permissions | Community (evaluate packages) | Low–Medium |
| Sub-agents | Community (`pi-subagents`) | Low |
| Web search/fetch | Community (`pi-web-access`) | Low |
| Task management | Community (`@tintinweb/pi-tasks`) | Low |
| System prompt assembly | Custom | Low |
| Config file system | Custom | Medium |
| Doom loop detection | Custom (hook) | Low |
| Retry logic | Custom (wrapper) | Low |
| Kibana tools (~15) | Custom | High |
| Elastic auth & client | Custom | Medium |
| Alert polling | Custom | Medium |
| Kibana LLM Gateway provider | Custom | Medium |
| Handover integration | Custom | Medium |
| API server (serve/acp) | Custom | Medium |
| Desktop app | Custom | High |
| Notebook editing | Custom | Medium |
| LSP integration | Custom | Medium |

### Key Takeaway

The core agent infrastructure (loop, providers, tools, TUI, sessions, extensions) is fully covered by Pi built-in + community. The custom work concentrates on the Elastic/Kibana integration layer and a few specialized features (API server, desktop app, LSP). A reasonable approach would be to ship the Elastic integration as a single Pi extension package.
