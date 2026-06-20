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
    success: "Prod .storage copied — registries, Lovelace, helpers, MQTT creds on staging. Auth not touched; MQTT broker patched if mirror enabled.",
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
    success: "Reloaded from repo — staging HA is now running the current git commit.",
    error: "Reload failed — check sync.log and git mount.",
    successIcon: "🌿",
    errorIcon: "📂💥",
  },
  "reset-workbench": {
    success: "Workbench reset — git matches GitHub, staging re-applied with prod .storage sync.",
    error: "Workbench reset failed — check sync.log and git mount.",
    successIcon: "🧹",
    errorIcon: "🧹💥",
  },
  "baseline-from-prod": {
    success: "Baseline from prod — git, GitHub, and staging rebuilt from live prod.",
    error: "Baseline from prod failed — check sync.log, prod SSH, and git mount.",
    successIcon: "🏁",
    errorIcon: "🏁💥",
  },
  "purge-deleted-entities": {
    success: "Deleted registry tombstones purged on prod — rename the live entity, then Recheck.",
    error: "Purge failed — check prod SSH and entity registry backup on prod.",
    successIcon: "🪦",
    errorIcon: "🪦💥",
  },
  "fix-prod-entity-suffix": {
    success: "Prod entity id fixed — Recheck Entity Janitor, then publish/deploy.",
    error: "Prod entity id fix failed — registry backup is on prod (.bak-kit-suffix-fix).",
    successIcon: "📺",
    errorIcon: "📺💥",
  },
  "fix-prod-entity-id": {
    success: "Prod entity id renamed in registry — Recheck Entity Janitor, then publish/deploy.",
    error: "Prod entity rename failed — registry backup is on prod (.bak-kit-entity-rename).",
    successIcon: "⏲️",
    errorIcon: "⏲️💥",
  },
  "snapshot-staging": {
    success: "Imported from staging HA — Lovelace and helpers written to git. Review in parity → Config & git before committing.",
    error: "Import failed — check that staging HA is running and the config path is mounted.",
    successIcon: "📸",
    errorIcon: "📸💥",
  },
  "push-github": {
    success: "Pushed to GitHub — staging branch is now on origin, deploy to prod HA is available.",
    error: "Push to GitHub failed — check git SSH key and remote URL.",
    successIcon: "📤",
    errorIcon: "📡💥",
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
  "prod-git-init": {
    success: "Prod HA git initialised — next deploy will apply config from main.",
    error: "Git init failed — check SSH access and prod config path.",
    successIcon: "🗂️",
    errorIcon: "🔧💥",
  },
  "deploy-prod": {
    success: "Deployed to prod HA — config bundled, applied, and reloaded.",
    error: "Deploy to prod HA failed — see Diagnostics for the error log.",
    successIcon: "✅",
    errorIcon: "🚨",
  },
  "request-release": {
    success: "Release applied — migrations run, config deployed, prod updated.",
    error: "Release failed — see Diagnostics for the error log.",
    successIcon: "🚢",
    errorIcon: "🚨",
  },
  "rollback-prod": {
    success: "Prod HA rolled back — previous deploy restored and reloaded.",
    error: "Prod rollback failed — see Diagnostics for details.",
    successIcon: "⏪",
    errorIcon: "🚨",
  },
  "rollback-release": {
    success: "Release rolled back — prod restored to the previous release snapshot.",
    error: "Release rollback failed — see Diagnostics for details.",
    successIcon: "⏪",
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

/** Best single-line reason from an operation failure (prefers logTail over generic message). */
export function operationErrorDetail(result: {
  ok: boolean;
  message?: string | null;
  logTail?: string | null;
}): string | null {
  if (result.ok) return null;

  const tail = result.logTail?.trim();
  if (tail) {
    const lines = tail
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (!/^Step \d+\/\d+/i.test(line)) return line;
    }
    return lines.at(-1) ?? null;
  }

  const message = result.message?.trim();
  if (message && !/^(action failed|operation failed)$/i.test(message)) return message;
  return null;
}

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
