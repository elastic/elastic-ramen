# Kibana Agent Builder: Conversation Update API

## Context

Elastic Console continuously syncs session state back to Kibana Agent Builder conversations.
When a user chats in Elastic Console, every completed assistant turn triggers a sync that pushes the full conversation (all rounds) to Kibana.

If the session was taken over from Kibana, it should update **the same** conversation rather than creating duplicates.
For fresh sessions it creates a new conversation on first sync, then keeps updating it.

## What exists today

| Method | Endpoint | Status |
|--------|----------|--------|
| `GET` | `/api/agent_builder/conversations` | Works (list) |
| `GET` | `/api/agent_builder/conversations/:id` | Works (get) |
| `POST` | `/api/agent_builder/conversations` | Works (create) |
| `POST` | `/api/agent_builder/conversations/:id/_handover` | Works (toggle handover flag) |
| `DELETE` | `/api/agent_builder/conversations/:id` | Works (delete) |
| `PUT` | `/api/agent_builder/conversations/:id` | **404 — does not exist** |

## What we need

### `PUT /api/agent_builder/conversations/:id`

Update an existing conversation's title and/or rounds.

**Request body** (all fields optional — only provided fields are updated):

```json
{
  "title": "Elastic Console: my session title",
  "rounds": [
    {
      "id": "round-1",
      "status": "completed",
      "input": { "message": "user message text" },
      "steps": [],
      "response": { "message": "assistant response text" },
      "started_at": "2026-03-13T09:00:00.000Z",
      "time_to_first_token": 0,
      "time_to_last_token": 0,
      "model_usage": {
        "connector_id": "opencode",
        "llm_calls": 1,
        "input_tokens": 0,
        "output_tokens": 0
      }
    }
  ]
}
```

**Expected response** (same shape as create):

```json
{
  "conversation": {
    "id": "b1536f3c-8c49-4521-81f4-021595eec7f6",
    "agent_id": "elastic-ai-agent",
    "user": { "id": "...", "username": "elastic" },
    "title": "Elastic Console: my session title",
    "created_at": "2026-03-13T09:00:00.000Z",
    "updated_at": "2026-03-13T09:44:00.000Z",
    "rounds": [ ... ],
    "handover_requested": false
  }
}
```

**Semantics:**

- `rounds` replaces the entire rounds array (not a merge/append). Elastic Console always sends the full conversation state.
- `title` updates the conversation title.
- The `agent_id` and other metadata should remain unchanged.
- If the conversation ID does not exist, return `404`.

**Headers** (same as all other Agent Builder endpoints):

```
kbn-xsrf: true
x-elastic-internal-origin: kibana
elastic-api-version: 2023-10-31
Content-Type: application/json
Authorization: ApiKey <key>
```

## Workaround (current)

Until the PUT endpoint is available, Elastic Console will use delete + recreate.
This loses the original conversation ID, so taken-over sessions won't stay linked to their original Kibana conversation.
