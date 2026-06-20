import type { ActivityEvent } from "../../api";

/** Sample events so layout previews look populated when the stream is quiet. */
export function getActivitySyncDemoEvents(): ActivityEvent[] {
  const now = Date.now();
  const iso = (offsetMs: number) => new Date(now - offsetMs).toISOString();

  return [
    {
      id: "demo-yak-p",
      instance: "Production HA",
      at: iso(90_000),
      entityId: "input_boolean.yak_reminder",
      domain: "notify",
      name: "Yak Reminder",
      message: "Reminder sent",
      parityMatch: true,
    },
    {
      id: "demo-yak-s",
      instance: "Staging HA",
      at: iso(87_000),
      entityId: "input_boolean.yak_reminder",
      domain: "notify",
      name: "Yak Reminder",
      message: "Reminder sent",
      parityMatch: true,
    },
    {
      id: "demo-med-p",
      instance: "Production HA",
      at: iso(240_000),
      entityId: "input_boolean.medication_reminder",
      domain: "notify",
      name: "Medication Reminder",
      message: "Reminder sent",
      parityMatch: true,
    },
    {
      id: "demo-med-s",
      instance: "Staging HA",
      at: iso(235_000),
      entityId: "input_boolean.medication_reminder",
      domain: "notify",
      name: "Medication Reminder",
      message: "Reminder sent",
      parityMatch: true,
    },
    {
      id: "demo-door-p",
      instance: "Production HA",
      at: iso(420_000),
      entityId: "automation.front_door_unlocked",
      domain: "automation",
      name: "Front door unlocked",
      message: "Triggered",
    },
    {
      id: "demo-presence-p",
      instance: "Production HA",
      at: iso(540_000),
      entityId: "automation.arrive_home",
      domain: "automation",
      name: "Arrive home lights",
      message: "Triggered",
    },
    {
      id: "demo-presence-s",
      instance: "Staging HA",
      at: iso(480_000),
      entityId: "automation.arrive_home",
      domain: "automation",
      name: "Arrive home lights",
      message: "Triggered",
    },
    {
      id: "demo-script-s",
      instance: "Staging HA",
      at: iso(660_000),
      entityId: "script.test_notify",
      domain: "script",
      name: "Test notify script",
      message: "Finished",
    },
  ];
}

export const SYNC_HISTORY_MS = 15 * 60 * 1000;
export const SYNC_PARITY_MS = 60_000;

export function isProdEvent(event: ActivityEvent) {
  return event.instance.includes("Production");
}

export function isStagingEvent(event: ActivityEvent) {
  return event.instance.includes("Staging");
}

export function eventAgeMs(event: ActivityEvent, now = Date.now()) {
  return now - new Date(event.at).getTime();
}

export function eventsInWindow(events: ActivityEvent[], windowMs = SYNC_HISTORY_MS) {
  const now = Date.now();
  return events.filter((event) => eventAgeMs(event, now) <= windowMs);
}

export function timePositionPct(at: string, windowMs = SYNC_HISTORY_MS) {
  const age = Date.now() - new Date(at).getTime();
  const clamped = Math.max(0, Math.min(windowMs, age));
  return 100 - (clamped / windowMs) * 100;
}
