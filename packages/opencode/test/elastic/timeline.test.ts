import { describe, expect, test } from "bun:test"
import { fromEvents, hydrate, toEvents, type Event } from "../../src/elastic/timeline"
import { Handover } from "../../src/elastic/handover"
import type { Conversation } from "../../src/elastic/client"

const round = Handover.round({ id: "r1", user: "hello", assistant: "hi there" })

function complete(id: string, user: string, assistant: string, extra: Event[] = []): Event[] {
  return [
    { id: `${id}::user_message`, type: "user_message", created_at: "2026-09-22T11:00:00.000Z", data: { message: user } },
    {
      id: `${id}::execution_started`,
      type: "execution_started",
      created_at: "2026-09-22T11:00:00.000Z",
      execution_id: `${id}::execution`,
      trigger_event_id: `${id}::user_message`,
      data: { trigger_type: "user_message" },
    },
    ...extra,
    {
      id: `${id}::execution_terminated`,
      type: "execution_terminated",
      created_at: "2026-09-22T11:00:05.000Z",
      execution_id: `${id}::execution`,
      trigger_event_id: `${id}::user_message`,
      data: {
        time_to_first_token: 10,
        time_to_last_token: 5000,
        model_usage: { connector_id: "x", llm_calls: 1, input_tokens: 2, output_tokens: 3 },
        outcome: { type: "responded", response: { message: assistant } },
      },
    },
  ]
}

describe("timeline.fromEvents", () => {
  test("rebuilds a completed round from events-native timeline", () => {
    const events = complete("abc", "are you up?", "yes", [
      {
        id: "abc::step::0",
        type: "execution_step",
        created_at: "2026-09-22T11:00:01.000Z",
        execution_id: "abc::execution",
        trigger_event_id: "abc::user_message",
        data: {
          sequence: 0,
          step: {
            type: "tool_call",
            tool_call_id: "t1",
            tool_id: "bash",
            params: { cmd: "uname" },
            results: [{ type: "text", tool_result_id: "out", value: "Darwin" }],
          },
        },
      },
    ])
    const rounds = fromEvents(events)
    expect(rounds).toHaveLength(1)
    expect(rounds[0].id).toBe("abc")
    expect(rounds[0].input.message).toBe("are you up?")
    expect(rounds[0].response.message).toBe("yes")
    expect(rounds[0].steps).toEqual([
      {
        type: "tool_call",
        tool_call_id: "t1",
        tool_id: "bash",
        params: { cmd: "uname" },
        results: [{ type: "text", tool_result_id: "out", value: "Darwin" }],
      },
    ])
  })

  test("rebuilds every completed turn", () => {
    const events = [...complete("r1", "one", "first"), ...complete("r2", "two", "second")]
    const rounds = fromEvents(events)
    expect(rounds.map((r) => r.input.message)).toEqual(["one", "two"])
    expect(rounds.map((r) => r.response.message)).toEqual(["first", "second"])
  })

  test("skips in-progress executions with no terminal event", () => {
    expect(
      fromEvents([
        { id: "r1::user_message", type: "user_message", created_at: "2026-09-22T11:00:00.000Z", data: { message: "hi" } },
      ]),
    ).toEqual([])
  })

  test("parses tool results stored as JSON strings", () => {
    const events = complete("abc", "q", "a", [
      {
        id: "abc::step::0",
        type: "execution_step",
        created_at: "2026-09-22T11:00:01.000Z",
        execution_id: "abc::execution",
        trigger_event_id: "abc::user_message",
        data: {
          sequence: 0,
          step: {
            type: "tool_call",
            tool_call_id: "t1",
            tool_id: "bash",
            params: {},
            results: JSON.stringify([{ type: "text", tool_result_id: "out", value: "ok" }]),
          },
        },
      },
    ])
    expect(fromEvents(events)[0].steps[0]).toMatchObject({
      type: "tool_call",
      results: [{ type: "text", tool_result_id: "out", value: "ok" }],
    })
  })
})

describe("timeline.hydrate", () => {
  const base = {
    id: "c1",
    agent_id: "elastic-ai-agent",
    user_name: "elastic",
    space: "default",
    title: "t",
    created_at: "2026-09-22T11:00:00.000Z",
    updated_at: "2026-09-22T11:00:00.000Z",
  }

  test("uses folded events when stored rounds are empty", () => {
    const conv = hydrate({
      ...base,
      conversation_rounds: [],
      events: complete("r1", "hello", "world"),
    } as Conversation)
    expect(conv.conversation_rounds).toHaveLength(1)
    expect(conv.conversation_rounds[0].input.message).toBe("hello")
    expect(Handover.rounds(conv)).toEqual([
      { input: "hello", output: "world", started: "2026-09-22T11:00:00.000Z" },
    ])
  })

  test("prefers the longer events-native history over a stale single round", () => {
    const conv = hydrate({
      ...base,
      conversation_rounds: [round],
      events: [...complete("r1", "one", "first"), ...complete("r2", "two", "second")],
    } as Conversation)
    expect(conv.conversation_rounds.map((r) => r.input.message)).toEqual(["one", "two"])
  })

  test("keeps stored rounds when they already have the same turn count", () => {
    const conv = hydrate({
      ...base,
      conversation_rounds: [round],
      events: complete("r1", "other", "text"),
    } as Conversation)
    expect(conv.conversation_rounds[0].input.message).toBe("hello")
  })
})

describe("timeline.toEvents", () => {
  test("round-trips a ramen round through events", () => {
    const events = toEvents([round], { agent: "elastic-ai-agent", user: "elastic" })
    const back = fromEvents(events)
    expect(back).toHaveLength(1)
    expect(back[0].input.message).toBe("hello")
    expect(back[0].response.message).toBe("hi there")
    expect(events.map((e) => e.type)).toEqual([
      "user_message",
      "execution_started",
      "execution_terminated",
    ])
  })
})
