import type { ToastTone } from "../components/Toast";

export type ActionToastPreset = {
  success: string;
  error: string;
  successIcon?: string;
  errorIcon?: string;
};

const presets: Record<string, ActionToastPreset> = {
  "storage-sync": {
    success: "Prod .storage copied — registries, dashboards, helpers, and MQTT creds are on staging.",
    error: "Storage sync face-planted — check SSH to prod and the staging config path.",
    successIcon: "📦",
    errorIcon: "🗄️💥",
  },
  "deploy-mirror": {
    success: "Mirror broker deployed — Mosquitto is live and listening.",
    error: "Mirror deploy went splat — run storage sync first, then try again.",
    successIcon: "🦇",
    errorIcon: "🪞💔",
  },
  "refresh-mirror": {
    success: "Mirror refreshed — broker config reloaded, Mosquitto still vibing.",
    error: "Mirror refresh noped out — check kit logs and try deploy again.",
    successIcon: "🔄🦇",
    errorIcon: "📡🫠",
  },
};

export function actionToast(
  presetKey: keyof typeof presets | string,
  ok: boolean,
  fallback: string
): { message: string; tone: ToastTone; icon?: string } {
  const preset = presets[presetKey];
  if (!preset) {
    return { message: fallback, tone: ok ? "ok" : "err", icon: ok ? "👍" : "💥" };
  }
  return ok
    ? { message: preset.success, tone: "ok", icon: preset.successIcon ?? "🎉" }
    : { message: preset.error, tone: "err", icon: preset.errorIcon ?? "🫠" };
}

export function testToast(ok: boolean, message: string): { message: string; tone: ToastTone; icon: string } {
  if (ok) {
    if (/reachable|ok|running|writable|present/i.test(message)) {
      return { message, tone: "ok", icon: "🎯" };
    }
    return { message, tone: "ok", icon: "✨" };
  }
  if (/timeout|warn|skip/i.test(message)) {
    return { message, tone: "warn", icon: "🐌" };
  }
  return { message, tone: "err", icon: "🔌🍌" };
}
