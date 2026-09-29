// Copyright (c) 2026-present, Elastic NV
import type { Conversation, ConversationRound } from "./client"

export interface Event {
  id: string
  type: string
  created_at: string
  execution_id?: string
  trigger_event_id?: string
  actor?: { type: string; id: string; username?: string }
  data?: Record<string, unknown>
}

const usage = {
  connector_id: "opencode",
  llm_calls: 1,
  input_tokens: 0,
  output_tokens: 0,
}

function parse(id: string): { round: string; index: number } | undefined {
  const match = /^(.*)::execution(?:::(\d+))?$/.exec(id)
  if (!match) return undefined
  return { round: match[1], index: Number(match[2] ?? 0) }
}

function results(raw: unknown) {
  const parsed = typeof raw === "string" && raw.startsWith("[") ? JSON.parse(raw) : raw
  if (!Array.isArray(parsed)) return []
  return parsed.flatMap((row) => {
    if (!row || typeof row !== "object") return []
    const value = "value" in row && typeof row.value === "string" ? row.value : ""
    const id = "tool_result_id" in row && typeof row.tool_result_id === "string" ? row.tool_result_id : ""
    return [{ type: "text" as const, tool_result_id: id, value }]
  })
}

function steps(raw: unknown[]) {
  return raw.flatMap((row): ConversationRound["steps"] => {
    if (!row || typeof row !== "object") return []
    const step = row as Record<string, unknown>
    if (step.type === "tool_call") {
      return [
        {
          type: "tool_call",
          tool_call_id: typeof step.tool_call_id === "string" ? step.tool_call_id : "",
          tool_id: typeof step.tool_id === "string" ? step.tool_id : "",
          params: step.params,
          results: results(step.results),
        },
      ]
    }
    if (step.type === "reasoning") {
      return [{ type: "reasoning", reasoning: typeof step.reasoning === "string" ? step.reasoning : "" }]
    }
    return []
  })
}

function message(data: unknown): string {
  if (!data || typeof data !== "object") return ""
  const value = (data as { message?: unknown }).message
  return typeof value === "string" ? value : ""
}

function reply(data: unknown): { message: string } {
  if (!data || typeof data !== "object") return { message: "" }
  const outcome = (data as { outcome?: { type?: string; response?: { message?: unknown } } }).outcome
  if (outcome?.type === "responded" && typeof outcome.response?.message === "string") {
    return { message: outcome.response.message }
  }
  return { message: "" }
}

export function fromEvents(events: Event[]): ConversationRound[] {
  const byId = new Map(events.map((event) => [event.id, event]))
  const groups = new Map<string, Event[]>()
  for (const event of events) {
    if (!event.execution_id) continue
    const group = groups.get(event.execution_id)
    if (group) group.push(event)
    else groups.set(event.execution_id, [event])
  }

  const rounds: ConversationRound[] = []
  for (const [exec, group] of groups) {
    const parsed = parse(exec) ?? { round: exec, index: 0 }
    const trigger = group.find((event) => event.trigger_event_id)
    const source = trigger?.trigger_event_id ? byId.get(trigger.trigger_event_id) : undefined
    const initial = source?.type === "user_message"
    const resume = source?.type === "prompt_response"
    if (!initial && !resume) continue

    const terminated = group.find((event) => event.type === "execution_terminated")
    if (!terminated) continue

    const stepEvents = group
      .filter((event) => event.type === "execution_step")
      .toSorted((a, b) => {
        const left = typeof a.data?.sequence === "number" ? a.data.sequence : 0
        const right = typeof b.data?.sequence === "number" ? b.data.sequence : 0
        return left - right
      })
    const raw = stepEvents.map((event) => event.data?.step).filter((step) => step !== undefined)
    const started = initial ? source : group.find((event) => event.type === "execution_started") ?? terminated
    const input = initial
      ? message(source.data)
      : message((source?.data as { input?: unknown } | undefined)?.input)
    const model = terminated.data?.model_usage
    rounds.push({
      id: parsed.round,
      status: "completed",
      input: { message: input },
      steps: steps(raw),
      response: reply(terminated.data),
      started_at: started?.created_at ?? terminated.created_at,
      time_to_first_token: typeof terminated.data?.time_to_first_token === "number" ? terminated.data.time_to_first_token : 0,
      time_to_last_token: typeof terminated.data?.time_to_last_token === "number" ? terminated.data.time_to_last_token : 0,
      model_usage:
        model && typeof model === "object"
          ? { ...usage, ...(model as ConversationRound["model_usage"]) }
          : usage,
    })
  }
  return rounds
}

export function hydrate(conv: Conversation): Conversation {
  const stored = conv.conversation_rounds ?? []
  const folded = fromEvents((conv.events ?? []) as Event[])
  if (!stored.length && folded.length) return { ...conv, conversation_rounds: folded }
  if (folded.length > stored.length) return { ...conv, conversation_rounds: folded }
  return { ...conv, conversation_rounds: stored }
}

export function toEvents(
  rounds: ConversationRound[],
  ctx: { agent: string; user: string; uid?: string },
): Event[] {
  const user = { type: "user", id: ctx.uid ?? ctx.user, username: ctx.user }
  const agent = { type: "agent", id: ctx.agent }
  return rounds.flatMap((round) => {
    const started = round.started_at
    const ended = new Date(new Date(started).getTime() + (round.time_to_last_token || 0)).toISOString()
    const exec = `${round.id}::execution`
    const trigger = `${round.id}::user_message`
    const stepEvents = round.steps.map((step, sequence) => ({
      id: `${round.id}::step::${sequence}`,
      type: "execution_step",
      created_at: started,
      actor: agent,
      execution_id: exec,
      trigger_event_id: trigger,
      data: { step, sequence },
    }))
    return [
      {
        id: trigger,
        type: "user_message",
        created_at: started,
        actor: user,
        data: { message: round.input.message },
      },
      {
        id: `${round.id}::execution_started`,
        type: "execution_started",
        created_at: started,
        actor: agent,
        execution_id: exec,
        trigger_event_id: trigger,
        data: { trigger_type: "user_message" },
      },
      ...stepEvents,
      {
        id: `${round.id}::execution_terminated`,
        type: "execution_terminated",
        created_at: ended,
        actor: agent,
        execution_id: exec,
        trigger_event_id: trigger,
        data: {
          model_usage: round.model_usage,
          time_to_first_token: round.time_to_first_token,
          time_to_last_token: round.time_to_last_token,
          outcome: { type: "responded", response: { message: round.response.message } },
        },
      },
    ]
  })
}
