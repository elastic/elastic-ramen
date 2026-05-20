import { describe, expect, mock, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { tmpdir } from "../../fixture/fixture"

const stop = new Error("stop")
const seen = {
  tui: [] as string[],
  inst: [] as string[],
  run: [] as Record<string, unknown>[],
}

mock.module("../../../src/cli/cmd/tui/app", () => ({
  tui: async (input: { directory: string }) => {
    seen.tui.push(input.directory)
    throw stop
  },
}))

mock.module("@/util/rpc", () => ({
  Rpc: {
    client: () => ({
      call: async () => ({ url: "http://127.0.0.1" }),
      on: () => {},
    }),
  },
}))

mock.module("@/cli/ui", () => ({
  UI: {
    error: () => {},
  },
}))

mock.module("@/util/log", () => ({
  Log: {
    init: async () => {},
    create: () => ({
      error: () => {},
      info: () => {},
      warn: () => {},
      debug: () => {},
      time: () => ({ stop: () => {} }),
    }),
    Default: {
      error: () => {},
      info: () => {},
      warn: () => {},
      debug: () => {},
    },
  },
}))

mock.module("@/util/timeout", () => ({
  withTimeout: <T>(input: Promise<T>) => input,
}))

mock.module("@/cli/network", () => ({
  withNetworkOptions: <T>(input: T) => input,
  resolveNetworkOptions: async () => ({
    mdns: false,
    port: 0,
    hostname: "127.0.0.1",
  }),
}))

mock.module("../../../src/cli/cmd/tui/win32", () => ({
  win32DisableProcessedInput: () => {},
  win32InstallCtrlCGuard: () => undefined,
}))

mock.module("@/config/tui", () => ({
  TuiConfig: {
    get: () => ({}),
  },
}))

mock.module("@/project/instance", () => ({
  Instance: {
    provide: async (input: { directory: string; fn: () => Promise<unknown> | unknown }) => {
      seen.inst.push(input.directory)
      return input.fn()
    },
  },
}))

mock.module("@/cli/cmd/run", () => ({
  RunCommand: {
    handler: async (args: Record<string, unknown>) => {
      seen.run.push(args)
      throw stop
    },
  },
}))

describe("tui thread", () => {
  async function call(project?: string, overrides?: Record<string, unknown>) {
    const { TuiThreadCommand } = await import("../../../src/cli/cmd/tui/thread")
    const args: Parameters<NonNullable<typeof TuiThreadCommand.handler>>[0] = {
      _: [],
      $0: "opencode",
      project,
      prompt: undefined,
      model: undefined,
      agent: undefined,
      session: undefined,
      continue: false,
      fork: false,
      port: 0,
      hostname: "127.0.0.1",
      mdns: false,
      "mdns-domain": "opencode.local",
      mdnsDomain: "opencode.local",
      cors: [],
      "kibana-base": undefined,
      kibanaBase: undefined,
      "kibana-agent": undefined,
      kibanaAgent: undefined,
      "allow-all": false,
      allowAll: false,
      ...overrides,
    }
    return TuiThreadCommand.handler(args)
  }

  async function check(project?: string) {
    await using tmp = await tmpdir({ git: true })
    const cwd = process.cwd()
    const pwd = process.env.PWD
    const worker = globalThis.Worker
    const tty = Object.getOwnPropertyDescriptor(process.stdin, "isTTY")
    const link = path.join(path.dirname(tmp.path), path.basename(tmp.path) + "-link")
    const type = process.platform === "win32" ? "junction" : "dir"
    seen.tui.length = 0
    seen.inst.length = 0
    await fs.symlink(tmp.path, link, type)

    Object.defineProperty(process.stdin, "isTTY", {
      configurable: true,
      value: true,
    })
    globalThis.Worker = class extends EventTarget {
      onerror = null
      onmessage = null
      onmessageerror = null
      postMessage() {}
      terminate() {}
    } as unknown as typeof Worker

    try {
      process.chdir(tmp.path)
      process.env.PWD = link
      await expect(call(project)).rejects.toBe(stop)
      expect(seen.inst[0]).toBe(tmp.path)
      expect(seen.tui[0]).toBe(tmp.path)
    } finally {
      process.chdir(cwd)
      if (pwd === undefined) delete process.env.PWD
      else process.env.PWD = pwd
      if (tty) Object.defineProperty(process.stdin, "isTTY", tty)
      else delete (process.stdin as { isTTY?: boolean }).isTTY
      globalThis.Worker = worker
      await fs.rm(link, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  async function headless(project: string | undefined, overrides: Record<string, unknown>) {
    seen.tui.length = 0
    seen.inst.length = 0
    seen.run.length = 0
    await expect(call(project, overrides)).rejects.toBe(stop)
    expect(seen.tui).toHaveLength(0)
    expect(seen.inst).toHaveLength(0)
    expect(seen.run).toHaveLength(1)
    return seen.run[0]!
  }

  test("uses the real cwd when PWD points at a symlink", async () => {
    await check()
  })

  test("uses the real cwd after resolving a relative project from PWD", async () => {
    await check(".")
  })

  test("--prompt routes to headless RunCommand with default format/thinking and no dir", async () => {
    const args = await headless(undefined, { prompt: "hello" })
    expect(args.message).toEqual(["hello"])
    expect(args.format).toBe("default")
    expect(args.thinking).toBe(false)
    expect("dir" in args).toBe(false)
  })

  test("--prompt forwards model/agent/continue/session/fork/project to RunCommand", async () => {
    const args = await headless("./relative", {
      prompt: "hi",
      model: "anthropic/claude-3-5-sonnet",
      agent: "build",
      continue: true,
      session: "abc",
      fork: true,
    })
    expect(args.model).toBe("anthropic/claude-3-5-sonnet")
    expect(args.agent).toBe("build")
    expect(args.continue).toBe(true)
    expect(args.session).toBe("abc")
    expect(args.fork).toBe(true)
    expect(args.dir).toBe("./relative")
  })
})
