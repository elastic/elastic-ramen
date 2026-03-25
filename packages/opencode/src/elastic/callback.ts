export namespace ElasticCallback {
  const PORT = 14642

  export interface Payload {
    es_url?: string
    elasticsearch_url?: string
    kibana_url?: string
    api_key?: string
    provider?: Record<string, unknown>
    model?: string
  }

  export interface Handle {
    url: string
    promise: Promise<Payload>
    stop: () => void
  }

  export function port() {
    return PORT
  }

  export function start(): Handle {
    let resolve: (payload: Payload) => void
    let server: ReturnType<typeof Bun.serve> | undefined

    const promise = new Promise<Payload>((r) => {
      resolve = r
    })

    const headers = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    }

    const successHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Elastic Console - Connected</title>
  <style>
    body {
      margin: 0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #1a1a2e;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: #e0e0e0;
    }
    .card {
      text-align: center;
      padding: 3rem 4rem;
      background: #16213e;
      border-radius: 12px;
      border: 1px solid #0f3460;
      box-shadow: 0 4px 24px rgba(0,0,0,0.3);
    }
    .badge {
      display: inline-block;
      font-size: 0.75rem;
      font-weight: 600;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      color: #00bcd4;
      border: 1px solid #00bcd4;
      border-radius: 999px;
      padding: 0.25rem 0.75rem;
      margin-bottom: 1.5rem;
    }
    h1 {
      margin: 0 0 0.5rem;
      font-size: 1.5rem;
      font-weight: 600;
      color: #ffffff;
    }
    p {
      margin: 0;
      font-size: 0.95rem;
      color: #94a3b8;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">Elastic Console</div>
    <h1>Connected</h1>
    <p>Credentials received. You can close this tab.</p>
  </div>
</body>
</html>`

    server = Bun.serve({
      port: PORT,
      async fetch(req) {
        if (req.method === "OPTIONS") return new Response(null, { status: 204, headers })

        if (req.method !== "POST") return new Response("method not allowed", { status: 405, headers })

        const contentType = req.headers.get("content-type") ?? ""
        let body: Payload

        if (contentType.includes("application/x-www-form-urlencoded")) {
          const formData = await req.formData()
          body = {} as Payload
          for (const key of ["es_url", "elasticsearch_url", "kibana_url", "api_key", "model"] as const) {
            const val = formData.get(key)
            if (typeof val === "string" && val) body[key] = val
          }
          const providerRaw = formData.get("provider")
          if (typeof providerRaw === "string" && providerRaw) {
            try {
              body.provider = JSON.parse(providerRaw)
            } catch {}
          }
          resolve(body)
          return new Response(successHtml, {
            status: 200,
            headers: { ...headers, "Content-Type": "text/html" },
          })
        }

        try {
          body = (await req.json()) as Payload
        } catch {
          return new Response("invalid json", { status: 400, headers })
        }

        resolve(body)
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { ...headers, "Content-Type": "application/json" },
        })
      },
    })

    const url = `http://localhost:${PORT}`

    return {
      url,
      promise,
      stop() {
        server?.stop(true)
        server = undefined
      },
    }
  }
}
