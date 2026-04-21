import { test, expect, describe } from "bun:test"
import { normalizeServer, parseMcpServers, parseClaudeMcp } from "../../src/cli/cmd/mcp-import"

describe("normalizeServer", () => {
  test("local: command + args + env", () => {
    expect(
      normalizeServer({ command: "node", args: ["/path/server.js", "--port", "3000"], env: { API_KEY: "secret" } }),
    ).toEqual({
      type: "local",
      command: ["node", "/path/server.js", "--port", "3000"],
      environment: { API_KEY: "secret" },
    })
  })

  test("local: command + args, no env", () => {
    expect(normalizeServer({ command: "npx", args: ["@mcp/server"] })).toEqual({
      type: "local",
      command: ["npx", "@mcp/server"],
    })
  })

  test("local: empty env is omitted", () => {
    expect(normalizeServer({ command: "node", args: ["s.js"], env: {} })).toEqual({
      type: "local",
      command: ["node", "s.js"],
    })
  })

  test("local: command only, no args", () => {
    expect(normalizeServer({ command: "my-server" })).toEqual({
      type: "local",
      command: ["my-server"],
    })
  })

  test("local: environment key (ramen style) as alias for env", () => {
    expect(normalizeServer({ command: "node", args: ["s.js"], environment: { K: "v" } })).toEqual({
      type: "local",
      command: ["node", "s.js"],
      environment: { K: "v" },
    })
  })

  test("remote: url only", () => {
    expect(normalizeServer({ url: "https://example.com/mcp" })).toEqual({
      type: "remote",
      url: "https://example.com/mcp",
    })
  })

  test("remote: url + headers", () => {
    expect(normalizeServer({ url: "https://x.com/mcp", headers: { Authorization: "Bearer t" } })).toEqual({
      type: "remote",
      url: "https://x.com/mcp",
      headers: { Authorization: "Bearer t" },
    })
  })

  test("remote: empty headers omitted", () => {
    expect(normalizeServer({ url: "https://x.com/mcp", headers: {} })).toEqual({
      type: "remote",
      url: "https://x.com/mcp",
    })
  })

  test("remote: type sse (VS Code style)", () => {
    expect(normalizeServer({ type: "sse", url: "https://x.com/mcp" })).toEqual({
      type: "remote",
      url: "https://x.com/mcp",
    })
  })

  test("url takes precedence over command", () => {
    expect(normalizeServer({ url: "https://x.com", command: "node", args: ["s.js"] })).toEqual({
      type: "remote",
      url: "https://x.com",
    })
  })

  test("returns undefined for empty object", () => {
    expect(normalizeServer({})).toBeUndefined()
  })

  test("returns undefined for unrecognized shape", () => {
    expect(normalizeServer({ name: "test", type: "stdio" })).toBeUndefined()
  })
})

describe("parseMcpServers", () => {
  test("Cursor format: mixed local + remote", () => {
    const result = parseMcpServers({
      mcpServers: {
        local: { command: "node", args: ["/path/s.js"], env: { K: "v" } },
        remote: { url: "https://example.com/mcp" },
      },
    })
    expect(Object.keys(result)).toEqual(["local", "remote"])
    expect(result["local"]).toEqual({ type: "local", command: ["node", "/path/s.js"], environment: { K: "v" } })
    expect(result["remote"]).toEqual({ type: "remote", url: "https://example.com/mcp" })
  })

  test("Windsurf format: strips disabledTools", () => {
    const result = parseMcpServers({
      mcpServers: {
        s: { command: "bash", args: ["-lc", "run.sh"], disabledTools: ["t1"] },
      },
    })
    expect(result["s"]).toEqual({ type: "local", command: ["bash", "-lc", "run.sh"] })
  })

  test("skips invalid entries", () => {
    const result = parseMcpServers({ mcpServers: { ok: { command: "node", args: ["s.js"] }, bad: { name: "x" } } })
    expect(Object.keys(result)).toEqual(["ok"])
  })

  test("custom key", () => {
    expect(parseMcpServers({ servers: { s: { url: "https://x.com" } } }, "servers")).toEqual({
      s: { type: "remote", url: "https://x.com" },
    })
  })

  test("VS Code: mcp.servers with stdio + sse types", () => {
    const data = {
      servers: {
        local: { type: "stdio", command: "node", args: ["s.js"] },
        remote: { type: "sse", url: "https://x.com/mcp" },
      },
    }
    const result = parseMcpServers(data, "servers")
    expect(result["local"]).toEqual({ type: "local", command: ["node", "s.js"] })
    expect(result["remote"]).toEqual({ type: "remote", url: "https://x.com/mcp" })
  })

  test("returns empty for missing key", () => {
    expect(parseMcpServers({})).toEqual({})
    expect(parseMcpServers(null)).toEqual({})
    expect(parseMcpServers(undefined)).toEqual({})
  })
})

describe("parseClaudeMcp", () => {
  test("global mcpServers", () => {
    const result = parseClaudeMcp({
      mcpServers: { s: { type: "stdio", command: "node", args: ["s.js"], env: { K: "v" } } },
    })
    expect(result["s"]).toEqual({ type: "local", command: ["node", "s.js"], environment: { K: "v" } })
  })

  test("per-project mcpServers for cwd", () => {
    const cwd = process.cwd()
    const result = parseClaudeMcp({
      projects: {
        [cwd]: { mcpServers: { proj: { command: "npx", args: ["x"] } } },
        "/other": { mcpServers: { other: { command: "node", args: ["o.js"] } } },
      },
    })
    expect(result["proj"]).toEqual({ type: "local", command: ["npx", "x"] })
    expect(result["other"]).toBeUndefined()
  })

  test("merges global + project", () => {
    const cwd = process.cwd()
    const result = parseClaudeMcp({
      mcpServers: { global: { command: "node", args: ["g.js"] } },
      projects: { [cwd]: { mcpServers: { local: { url: "https://x.com" } } } },
    })
    expect(Object.keys(result).sort()).toEqual(["global", "local"])
  })

  test("remote http type", () => {
    const result = parseClaudeMcp({ mcpServers: { r: { type: "http", url: "https://mcp.stripe.com" } } })
    expect(result["r"]).toEqual({ type: "remote", url: "https://mcp.stripe.com" })
  })

  test("returns empty for no servers", () => {
    expect(parseClaudeMcp({})).toEqual({})
    expect(parseClaudeMcp({ projects: {} })).toEqual({})
    expect(parseClaudeMcp(null)).toEqual({})
    expect(parseClaudeMcp(undefined)).toEqual({})
  })
})
