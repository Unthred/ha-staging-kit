import type { ToastTone } from "../components/Toast";

export type ActionToastPreset = {
  success: string;
  error: string;
  successIcon?: string;
  errorIcon?: string;
  successTone?: ToastTone;
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
  "apply-config": {
    success: "Git config applied — staging YAML updated from the repo branch.",
    error: "Apply config failed — check sync.log and git mount.",
    successIcon: "🌿",
    errorIcon: "📂💥",
  },
  "person-poll": {
    success: "Person poll done — prod presence copied to staging.",
    error: "Person poll failed — check prod/staging tokens and URLs.",
    successIcon: "👥",
    errorIcon: "🛰️🫠",
  },
  "restart-staging": {
    success: "Staging HA restarted — give it a minute to come back up.",
    error: "Restart failed — check STAGING_HA_CONTAINER in Settings.",
    successIcon: "🔄🏠",
    errorIcon: "🏚️💥",
  },
  "ship-staging": {
    success: "Shipped to staging — pushed, applied, and restarted.",
    error: "Ship to staging failed — see details below.",
    successIcon: "🚀",
    errorIcon: "📦💥",
  },
  "deploy-prod": {
    success: "Promoted to main — GitHub Actions will update HA Green.",
    error: "Deploy to prod failed — check git merge/push output.",
    successIcon: "✅",
    errorIcon: "🚨",
  },
  "mirror-readonly": {
    success: "Mirror back to read-only — staging cannot actuate prod devices now.",
    error: "Could not switch mirror to read-only.",
    successIcon: "🛡️🦇",
    errorIcon: "⚡🫠",
    successTone: "ok",
  },
  "mirror-control-on": {
    success: "Control mode ON — real devices can move. Turn off when finished testing.",
    error: "Could not enable control mode.",
    successIcon: "⚠️🎮",
    errorIcon: "🚫",
    successTone: "warn",
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
    ? {
        message: preset.success,
        tone: preset.successTone ?? "ok",
        icon: preset.successIcon ?? "🎉",
      }
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
