// The process-wide time source for row timestamps (created_at / updated_at). Spec §7.2: timestamps come
// from the server ClockPort, never the database or the client. The container sets it from its ClockPort,
// so tests and the back-dated demo seed stamp rows with their own clock.
import { systemClock, type ClockPort } from "./clock";

let current: ClockPort = systemClock;

export function setTimeSource(clock: ClockPort): void {
  current = clock;
}

export function now(): Date {
  return current.now();
}
