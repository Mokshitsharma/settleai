// In-process event hub powering the live Agent Activity panel over SSE (spec §13.2).
// Channels: "job:<id>", "user:<id>", "admin" (firehose). Keeps a short replay buffer per channel.

export interface DomainEvent {
  id: number;
  channel: string;
  type: string; // e.g. "agent.step", "agent.done", "job.funded", "payout.succeeded"
  at: string;
  message: string;
  data?: Record<string, unknown>;
}

type Listener = (e: DomainEvent) => void;

const BUFFER = 200;

export class EventHub {
  private seq = 0;
  private listeners = new Map<string, Set<Listener>>();
  private buffers = new Map<string, DomainEvent[]>();

  publish(channel: string, type: string, message: string, data?: Record<string, unknown>): DomainEvent {
    const event: DomainEvent = { id: ++this.seq, channel, type, at: new Date().toISOString(), message, data };
    for (const ch of channel === "admin" ? ["admin"] : [channel, "admin"]) {
      const buf = this.buffers.get(ch) ?? [];
      buf.push(event);
      if (buf.length > BUFFER) buf.shift();
      this.buffers.set(ch, buf);
      this.listeners.get(ch)?.forEach((l) => l(event));
    }
    return event;
  }

  subscribe(channel: string, listener: Listener, sinceId = 0): () => void {
    for (const e of this.buffers.get(channel) ?? []) if (e.id > sinceId) listener(e);
    const set = this.listeners.get(channel) ?? new Set();
    set.add(listener);
    this.listeners.set(channel, set);
    return () => set.delete(listener);
  }

  recent(channel: string): DomainEvent[] {
    return [...(this.buffers.get(channel) ?? [])];
  }
}

/** Emits events for a run to the job channel when there is one, otherwise only to admin. */
export type Emit = (type: string, message: string, data?: Record<string, unknown>) => void;

export function emitterFor(hub: EventHub, channel: string): Emit {
  return (type, message, data) => {
    hub.publish(channel, type, message, data);
  };
}
