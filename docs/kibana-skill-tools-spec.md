# Spec: elastic_console Skill & Tool APIs for CLI Integration

## Problem

elastic-console (the CLI) needs to:
1. List available skills from the Agent Builder
2. Load a skill's full content when activated
3. Discover **all** tools a skill provides — including inline (skill-bounded) tools that only exist in code, not in the tool registry
4. Execute those tools on behalf of the LLM

The existing public Agent Builder APIs (`/api/agent_builder/skills`, `/api/agent_builder/tools`) are insufficient because:

- **`GET /api/agent_builder/skills/{id}`** returns `PublicSkillDefinition` which includes `tool_ids` (registry tool references) but **omits inline tool definitions** — built-in skills define tools via `getInlineTools()` which returns `SkillBoundedTool[]` (esql, index_search, workflow, or builtin tools with schemas and handlers). These are never surfaced in the API response.
- **`GET /api/agent_builder/tools/{id}`** only works for registry tools. Inline/skill-bounded tools have no registry IDs and cannot be fetched or executed through the tools API.
- **`POST /api/agent_builder/tools/_execute`** only executes registry tools via `registry.get(id)`. Inline tools are loaded dynamically into the runner's `ToolManager` during conversation (via `loadSkillToolsAfterRead` hook) and have no standalone execution path.

## Proposed Solution

Add three new **internal** routes to the `elastic_console` Kibana plugin that proxy into the `agentBuilder` plugin's server-side services. These are internal routes (not public APIs) because elastic-console already uses `elastic-api-version: 2023-10-31` and internal routes for conversations.

### New Plugin Dependency

`elastic_console` must add `agentBuilder` as an **optional** plugin dependency so it can access the skills and tools services when available.

**File: `kibana.jsonc`**
```jsonc
{
  "plugin": {
    "optionalPlugins": ["cloud", "agentBuilder"]
  }
}
```

**File: `server/types.ts`**
```ts
import type { AgentBuilderPluginStart } from '@kbn/agent-builder-plugin/server';

export interface ElasticConsoleStartDependencies {
  inference: InferenceServerStart;
  actions: ActionsPluginStart;
  agentBuilder?: AgentBuilderPluginStart;
}
```

---

### Route 1: List Skills

```
GET /internal/elastic_console/skills
```

**Purpose:** List all available skills (built-in + persisted) with summary info.

**Response:**
```json
{
  "results": [
    {
      "id": "security-alerts-rules",
      "name": "alerts-rules",
      "description": "Manage security alert rules",
      "readonly": true,
      "plugin_id": "securitySolution",
      "tool_ids": [],
      "inline_tool_count": 3,
      "referenced_content_count": 2
    },
    {
      "id": "my-custom-skill",
      "name": "my-custom-skill",
      "description": "A user-created skill",
      "readonly": false,
      "tool_ids": ["my-esql-tool", "my-index-search"],
      "inline_tool_count": 0,
      "referenced_content_count": 0
    }
  ]
}
```

**Key addition vs `GET /api/agent_builder/skills`:** Includes `inline_tool_count` so the CLI knows if the skill has hidden tools that aren't in `tool_ids`.

**Implementation:**
```ts
const [coreStart, { agentBuilder }] = await coreSetup.getStartServices();
if (!agentBuilder) return response.notFound();

const skillRegistry = await agentBuilder.skills.getRegistry({ request });
const skills = await skillRegistry.list();

const results = await Promise.all(skills.map(async (skill) => ({
  id: skill.id,
  name: skill.name,
  description: skill.description,
  readonly: skill.readonly,
  plugin_id: skill.plugin_id,
  tool_ids: await skill.getRegistryTools(),
  inline_tool_count: ((await skill.getInlineTools?.()) ?? []).length,
  referenced_content_count: skill.referencedContentCount,
})));

return response.ok({ body: { results } });
```

---

### Route 2: Get Skill with Tools

```
GET /internal/elastic_console/skills/{skillId}
```

**Purpose:** Get full skill content AND complete tool definitions (both registry and inline) with their JSON schemas.

**Response:**
```json
{
  "id": "security-alerts-rules",
  "name": "alerts-rules",
  "description": "Manage security alert rules",
  "content": "# Alerts & Rules\n\nThis skill helps you...",
  "referenced_content": [
    { "name": "reference.md", "relativePath": "./reference.md", "content": "..." }
  ],
  "readonly": true,
  "plugin_id": "securitySolution",
  "tools": [
    {
      "id": "get-alerts",
      "type": "builtin",
      "description": "Search for security alerts",
      "schema": {
        "type": "object",
        "properties": {
          "query": { "type": "string" },
          "size": { "type": "number" }
        }
      }
    },
    {
      "id": "my-esql-tool",
      "type": "esql",
      "description": "Run an ES|QL query for log analysis",
      "schema": {
        "type": "object",
        "properties": {
          "query_params": { "type": "object" }
        }
      }
    }
  ]
}
```

**Key addition vs `GET /api/agent_builder/skills/{id}`:** The `tools` array includes **all** tools (both registry and inline) with their JSON schemas resolved. The existing public API only returns `tool_ids` (string array) and has no inline tool info.

**Implementation:**
```ts
const [coreStart, { agentBuilder }] = await coreSetup.getStartServices();
if (!agentBuilder) return response.notFound();

const skillRegistry = await agentBuilder.skills.getRegistry({ request });
const skill = await skillRegistry.get(skillId);
if (!skill) return response.notFound();

// Collect all tools with schemas
const tools = [];

// 1. Registry tools — fetch from tool registry with schemas
const registryToolIds = await skill.getRegistryTools();
if (registryToolIds.length > 0) {
  const toolRegistry = await agentBuilder.tools.getRegistry({ request });
  for (const toolId of registryToolIds) {
    const tool = await toolRegistry.get(toolId);
    const toolSchema = await tool.getSchema();
    tools.push({
      id: tool.id,
      type: tool.type,
      description: tool.description,
      schema: z.toJSONSchema(toolSchema, { unrepresentable: 'any', io: 'input' }),
    });
  }
}

// 2. Inline tools — extract from getInlineTools() and resolve schemas
const inlineTools = (await skill.getInlineTools?.()) ?? [];
for (const inlineTool of inlineTools) {
  const toolEntry: any = {
    id: inlineTool.id,
    type: inlineTool.type,
    description: inlineTool.description,
  };
  // Builtin inline tools have getSchema(); others have configuration that implies schema
  if ('getSchema' in inlineTool && typeof inlineTool.getSchema === 'function') {
    const schema = await inlineTool.getSchema();
    toolEntry.schema = z.toJSONSchema(schema, { unrepresentable: 'any', io: 'input' });
  } else {
    // For esql/index_search/workflow inline tools, derive schema from tool type definition
    // These tool types have a standard schema based on their configuration
    toolEntry.schema = {};
    toolEntry.configuration = inlineTool.configuration;
  }
  tools.push(toolEntry);
}

return response.ok({
  body: {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    content: skill.content,
    referenced_content: skill.referencedContent?.map(rc => ({
      name: rc.name,
      relativePath: rc.relativePath,
      content: rc.content,
    })),
    readonly: skill.readonly,
    plugin_id: skill.plugin_id,
    tools,
  },
});
```

**Note on inline tool schema resolution:** The tricky part is that `SkillBoundedTool` is a union type:
- `BuiltinSkillBoundedTool` — has `getSchema()` and `getHandler()` directly
- `StaticEsqlSkillBoundedTool` — has `configuration` with the ES|QL template; schema is derived by the tool type definition
- `IndexSearchSkillBoundedTool` — has `configuration` with index search config
- `WorkflowSkillBoundedTool` — has `configuration` with workflow_id

For non-builtin inline tools, we may need to use the tool type definitions to derive the schema (same way `convertTool` does in the runner). Alternatively, we can expose the configuration and let the CLI pass it through to the execute endpoint.

---

### Route 3: Execute Skill Tool

```
POST /internal/elastic_console/skills/{skillId}/tools/_execute
```

**Purpose:** Execute a tool that belongs to a specific skill. Works for both registry tools and inline (skill-bounded) tools.

**Request:**
```json
{
  "tool_id": "get-alerts",
  "tool_params": {
    "query": "host.name: server-01",
    "size": 10
  }
}
```

**Response:**
```json
{
  "results": [
    { "type": "text", "value": "Found 3 alerts matching..." }
  ]
}
```

**Implementation:**
```ts
const [coreStart, { agentBuilder }] = await coreSetup.getStartServices();
if (!agentBuilder) return response.notFound();

const { tool_id: toolId, tool_params: toolParams } = request.body;

// First, try registry tools (works for both skill registry tools and standalone tools)
try {
  const toolRegistry = await agentBuilder.tools.getRegistry({ request });
  if (await toolRegistry.has(toolId)) {
    const result = await toolRegistry.execute({
      toolId,
      toolParams,
      source: 'user',
    });
    return response.ok({ body: { results: result.results } });
  }
} catch { /* fall through to inline tools */ }

// For inline tools, we need to load the skill, find the inline tool, convert it,
// and execute it directly
const skillRegistry = await agentBuilder.skills.getRegistry({ request });
const skill = await skillRegistry.get(skillId);
if (!skill) return response.notFound({ body: { message: `Skill '${skillId}' not found` } });

const inlineTools = (await skill.getInlineTools?.()) ?? [];
const inlineTool = inlineTools.find(t => t.id === toolId);
if (!inlineTool) {
  return response.notFound({ body: { message: `Tool '${toolId}' not found in skill '${skillId}'` } });
}

// Convert the inline tool to an executable tool and run it
// This requires the SkillsService.convertSkillTool() which needs a runner context
// Alternative: use agentBuilder.tools.execute() with an internal flag
const executableTool = /* convert and execute inline tool */;
const result = await executableTool.execute({ toolParams });

return response.ok({ body: { results: result.results } });
```

**Open question — inline tool execution:** The current architecture converts inline tools to `ExecutableTool` via `SkillsService.convertSkillTool()`, which requires a `Runner` instance (for the `toExecutableTool` call). The runner is only created during agent conversation execution. Options:

1. **Expose a standalone execution path on `AgentBuilderPluginStart`** — e.g. `agentBuilder.tools.executeSkillTool(skillId, toolId, toolParams, request)` that internally creates a minimal runner context.
2. **Use the existing `tools._execute` route internally** — works for registry tools but not inline tools.
3. **Add inline tools to the tool registry temporarily** — when the elastic_console route is called, register the inline tools as ephemeral tools and execute via the standard path.
4. **Create a lightweight runner** — just enough to call `convertSkillTool` + execute, without a full conversation context.

**Recommendation:** Option 1 is cleanest. Add a method to `AgentBuilderPluginStart.tools`:
```ts
export interface ToolsStart {
  execute: RunToolFn;
  getRegistry: (opts: { request: KibanaRequest }) => Promise<ToolRegistry>;
  // NEW: Execute a skill-scoped tool (inline or registry)
  executeSkillTool: (opts: {
    request: KibanaRequest;
    skillId: string;
    toolId: string;
    toolParams: Record<string, unknown>;
  }) => Promise<ToolResult>;
}
```

---

## What Needs to Change in agent_builder Plugin

### 1. Expose `getInlineTools` data through a service method (minimal)

The `InternalSkillDefinition.getInlineTools()` is already available on the skill object returned by the registry. The elastic_console plugin just needs access to the registry (via `agentBuilder.skills.getRegistry()`), which is already exposed in `AgentBuilderPluginStart.skills`.

**No changes needed** for reading inline tool metadata and schemas.

### 2. Expose inline tool schema resolution

For `BuiltinSkillBoundedTool`, `getSchema()` is directly available.
For `StaticEsqlSkillBoundedTool`, `IndexSearchSkillBoundedTool`, `WorkflowSkillBoundedTool`, the schema needs to be derived via the tool type definition system.

**Option A (preferred):** Add a utility function to `@kbn/agent-builder-server` or the skill service:
```ts
// In skill_service or a shared util
getSkillToolSchema(tool: SkillBoundedTool): Promise<JSONSchema>
```

**Option B:** Export the existing `convertTool` + `toDescriptorWithSchema` pipeline and let elastic_console use it.

### 3. Expose inline tool execution (for Route 3)

Add `executeSkillTool` to `ToolsStart` (or `SkillsStart`) as described above. This method would:
1. Load the skill from the registry
2. Find the inline tool by ID
3. Convert it to an executable tool (using the existing `createSkillToolConverter` logic)
4. Execute it and return results

This requires a lightweight runner instance. The `ToolsServiceStart` already has access to the runner factory.

---

## Files Summary

### elastic_console plugin (new/modify)

| File | Change |
|------|--------|
| `kibana.jsonc` | Add `agentBuilder` to `optionalPlugins` |
| `server/types.ts` | Add `AgentBuilderPluginStart` to `ElasticConsoleStartDependencies` |
| `server/routes/index.ts` | Register `registerSkillRoutes` |
| `server/routes/skills.ts` **(new)** | Three routes: list skills, get skill with tools, execute skill tool |

### agent_builder plugin (modify)

| File | Change |
|------|--------|
| `server/types.ts` | Add `executeSkillTool` to `ToolsStart` interface |
| `server/services/tools/tools_service.ts` | Implement `executeSkillTool` |
| `server/services/skills/utils.ts` | Add `getSkillToolSchemas()` utility for resolving inline tool schemas |

### Packages (possibly modify)

| Package | Change |
|---------|--------|
| `@kbn/agent-builder-server` | Optionally export a `resolveSkillToolSchema` helper |

---

## Graceful Degradation

- If `agentBuilder` plugin is not available (not installed, or experimental features disabled), all three routes return `404`.
- The CLI (`elastic-console`) should handle 404/403 from these endpoints gracefully and skip Kibana skill loading.
- The existing `ElasticAuth.check()` guard in the CLI already handles the case where Kibana is not configured.

## Security

- All routes use `requiredPrivileges: ['agentBuilder:write']` consistent with existing elastic_console conversation routes.
- Tool execution inherits the calling user's permissions (request-scoped registries handle this).
