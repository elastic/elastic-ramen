# Kibana-side implementation: opencode callback integration

When a user launches the opencode TUI without configured Elastic credentials, the CLI
starts a temporary HTTP server on `localhost:14642` and directs the user to Kibana's
onboarding page. Kibana should detect the `callback` query parameter and POST the
credentials directly to that server, removing the need for copy/paste.

## How it works (end-to-end)

```
opencode TUI                          Browser / Kibana
─────────────                         ─────────────────
1. Start HTTP server on :14642
2. Show Kibana link with
   ?callback=http://localhost:14642
                                      3. User opens link
                                      4. Kibana reads `callback` param
                                      5. Kibana generates credentials
                                      6. Kibana POSTs JSON to callback URL
7. Server receives POST
8. Save config, verify health
9. Close dialog, shut down server
```

## What Kibana receives

The onboarding page URL will look like:

```
https://<kibana>/app/observabilityOnboarding/opencode?callback=http%3A%2F%2Flocalhost%3A14642
```

The `callback` query parameter is URL-encoded. Decode it to get the target:

```ts
const params = new URLSearchParams(window.location.search);
const callback = params.get("callback"); // "http://localhost:14642"
```

## What Kibana should POST

Send a single `POST` request with `Content-Type: application/json` to the callback URL.

### Payload schema

| Field             | Type     | Required | Description                                             |
|-------------------|----------|----------|---------------------------------------------------------|
| `es_url`          | `string` | **yes**  | Elasticsearch URL (alias: `elasticsearch_url`)          |
| `kibana_url`      | `string` | no       | Kibana URL (used for Kibana API tools)                  |
| `api_key`         | `string` | **yes**  | Elasticsearch API key                                   |
| `provider`        | `object` | no       | LLM provider config (written to project `opencode.json`)|
| `model`           | `string` | no       | Default model ID (written alongside provider)           |

### Minimal example

```json
{
  "es_url": "https://my-cluster.es.us-east-1.aws.elastic.cloud:443",
  "api_key": "bXlfa2V5OmFiYzEyMw=="
}
```

### Full example

```json
{
  "es_url": "https://my-cluster.es.us-east-1.aws.elastic.cloud:443",
  "kibana_url": "https://my-cluster.kb.us-east-1.aws.elastic.cloud:443",
  "api_key": "bXlfa2V5OmFiYzEyMw==",
  "provider": {
    "bedrock": {
      "aws": {
        "region": "us-east-1",
        "accessKeyId": "AKIA...",
        "secretAccessKey": "..."
      }
    }
  },
  "model": "us.anthropic.claude-sonnet-4-20250514-v1:0"
}
```

## CORS

The opencode server responds with these headers on every request:

```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: POST, OPTIONS
Access-Control-Allow-Headers: Content-Type
```

Browsers will send a preflight `OPTIONS` request first. The server returns `204` for
those. The actual `POST` gets back `200` with `{"ok": true}` on success.

## Reference implementation (Kibana page)

```ts
async function sendCredentials(callback: string, payload: object): Promise<boolean> {
  try {
    const res = await fetch(callback, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return res.ok;
  } catch {
    // Server not running or user closed the TUI — fall back to copy/paste
    return false;
  }
}

// Usage in the onboarding page component:
const params = new URLSearchParams(window.location.search);
const callback = params.get("callback");

if (callback) {
  const payload = {
    es_url: elasticsearchUrl,
    kibana_url: kibanaUrl,
    api_key: generatedApiKey,
    // optional:
    provider: providerConfig,
    model: selectedModel,
  };

  const sent = await sendCredentials(callback, payload);

  if (sent) {
    // Show success: "Credentials sent to opencode! You can return to your terminal."
  } else {
    // Fall back to showing the JSON for manual copy/paste
  }
} else {
  // No callback param — show the JSON for manual copy/paste (existing behavior)
}
```

## Responses from the callback server

| Status | Meaning                              |
|--------|--------------------------------------|
| `204`  | Preflight OK (response to `OPTIONS`) |
| `200`  | Credentials received successfully    |
| `400`  | Body was not valid JSON              |
| `405`  | Wrong HTTP method (only POST allowed)|

## Edge cases to handle on the Kibana side

- **No `callback` param**: fall back to the existing copy/paste UI.
- **`fetch` throws** (e.g. `ERR_CONNECTION_REFUSED`): the user closed the TUI or the
  server isn't running. Show the JSON for manual copy/paste instead.
- **Non-200 response**: show the JSON for manual copy/paste with a note that automatic
  delivery failed.
- **Port conflict**: the port `14642` is fixed. If something else occupies it, the
  opencode side will fail to start the server and the dialog falls back to the manual
  paste mode. Kibana doesn't need to worry about this — the `fetch` will simply fail.

## Security notes

This is a POC-grade local loopback mechanism, not a production OAuth flow.

- The server binds to `localhost` only — not reachable from other machines.
- It accepts `*` for CORS origin because the request comes from a Kibana page on a
  different origin.
- The server shuts down as soon as the TUI dialog closes (credentials received or user
  cancels).
- The API key has whatever permissions the Kibana onboarding page generates — no
  additional scope is granted by this mechanism.
