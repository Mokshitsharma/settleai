// Server time only. Client timestamps are never trusted for enforcement.
export interface ClockPort {
  now(): Date;
}

export const systemClock: ClockPort = { now: () => new Date() };

/** Deterministic clock for tests and eval scenarios. */
export class FixedClock implements ClockPort {
  constructor(private current: Date) {}
  now(): Date {
    return new Date(this.current);
  }
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
  set(date: Date): void {
    this.current = new Date(date);
  }
}
