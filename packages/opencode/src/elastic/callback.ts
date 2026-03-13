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

    server = Bun.serve({
      port: PORT,
      fetch(req) {
        if (req.method === "OPTIONS") return new Response(null, { status: 204, headers })

        if (req.method !== "POST") return new Response("method not allowed", { status: 405, headers })

        return req.json().then(
          (body) => {
            resolve(body as Payload)
            return new Response(JSON.stringify({ ok: true }), {
              status: 200,
              headers: { ...headers, "Content-Type": "application/json" },
            })
          },
          () => new Response("invalid json", { status: 400, headers }),
        )
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
