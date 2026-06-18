export type ThemeMode = "light" | "dark" | "system";
export type UiDensity = "compact" | "comfortable";
export type FontScale = "small" | "default" | "large";
export type StatusIntensity = "soft" | "default" | "strong";

export type AppearanceSettings = {
  themeMode: ThemeMode;
  badgeColor: string;
  accentColor: string;
  density: UiDensity;
  fontScale: FontScale;
  reduceMotion: boolean;
  statusIntensity: StatusIntensity;
  hideNavBadges: boolean;
  highContrast: boolean;
};

export const APPEARANCE_STORAGE = {
  cache: "ha-kit-appearance-cache",
} as const;

export const BADGE_COLOR_PRESETS = [
  { id: "amber", label: "Amber", value: "#ffb74d" },
  { id: "orange", label: "Orange", value: "#f97316" },
  { id: "red", label: "Red", value: "#ef5350" },
  { id: "blue", label: "Blue", value: "#03a9f4" },
  { id: "green", label: "Green", value: "#4caf50" },
  { id: "purple", label: "Purple", value: "#a78bfa" },
  { id: "pink", label: "Pink", value: "#f472b6" },
] as const;

export const ACCENT_COLOR_PRESETS = [
  { id: "cyan", label: "Cyan", value: "#03a9f4" },
  { id: "blue", label: "Blue", value: "#2563eb" },
  { id: "teal", label: "Teal", value: "#14b8a6" },
  { id: "green", label: "Green", value: "#22c55e" },
  { id: "violet", label: "Violet", value: "#8b5cf6" },
  { id: "rose", label: "Rose", value: "#f43f5e" },
  { id: "amber", label: "Amber", value: "#f59e0b" },
] as const;

export const DEFAULT_APPEARANCE: AppearanceSettings = {
  themeMode: "dark",
  badgeColor: BADGE_COLOR_PRESETS[0].value,
  accentColor: ACCENT_COLOR_PRESETS[0].value,
  density: "comfortable",
  fontScale: "default",
  reduceMotion: false,
  statusIntensity: "default",
  hideNavBadges: false,
  highContrast: false,
};

export function resolveTheme(mode: ThemeMode): "light" | "dark" {
  if (mode === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return mode;
}

function isHex(value: string) {
  return /^#[0-9a-fA-F]{6}$/.test(value);
}

export function normalizeAppearance(raw: Partial<AppearanceSettings> | null | undefined): AppearanceSettings {
  const d = DEFAULT_APPEARANCE;
  return {
    themeMode: raw?.themeMode === "light" || raw?.themeMode === "dark" || raw?.themeMode === "system" ? raw.themeMode : d.themeMode,
    badgeColor: raw?.badgeColor && isHex(raw.badgeColor) ? raw.badgeColor : d.badgeColor,
    accentColor: raw?.accentColor && isHex(raw.accentColor) ? raw.accentColor : d.accentColor,
    density: raw?.density === "compact" || raw?.density === "comfortable" ? raw.density : d.density,
    fontScale: raw?.fontScale === "small" || raw?.fontScale === "default" || raw?.fontScale === "large" ? raw.fontScale : d.fontScale,
    reduceMotion: raw?.reduceMotion ?? d.reduceMotion,
    statusIntensity:
      raw?.statusIntensity === "soft" || raw?.statusIntensity === "default" || raw?.statusIntensity === "strong"
        ? raw.statusIntensity
        : d.statusIntensity,
    hideNavBadges: raw?.hideNavBadges ?? d.hideNavBadges,
    highContrast: raw?.highContrast ?? d.highContrast,
  };
}

export function appearanceFromApi(raw: {
  themeMode?: string;
  badgeColor?: string;
  accentColor?: string;
  density?: string;
  fontScale?: string;
  reduceMotion?: boolean;
  statusIntensity?: string;
  hideNavBadges?: boolean;
  highContrast?: boolean;
} | null | undefined): AppearanceSettings {
  return normalizeAppearance({
    themeMode: raw?.themeMode as ThemeMode | undefined,
    badgeColor: raw?.badgeColor,
    accentColor: raw?.accentColor,
    density: raw?.density as UiDensity | undefined,
    fontScale: raw?.fontScale as FontScale | undefined,
    reduceMotion: raw?.reduceMotion,
    statusIntensity: raw?.statusIntensity as StatusIntensity | undefined,
    hideNavBadges: raw?.hideNavBadges,
    highContrast: raw?.highContrast,
  });
}

export function appearanceEquals(a: AppearanceSettings, b: AppearanceSettings) {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function loadCachedAppearance(): AppearanceSettings | null {
  try {
    const raw = localStorage.getItem(APPEARANCE_STORAGE.cache);
    if (!raw) return null;
    return normalizeAppearance(JSON.parse(raw) as Partial<AppearanceSettings>);
  } catch {
    return null;
  }
}

export function cacheAppearance(prefs: AppearanceSettings) {
  localStorage.setItem(APPEARANCE_STORAGE.cache, JSON.stringify(prefs));
}

export function loadLegacyAppearance(): AppearanceSettings | null {
  const themeMode = localStorage.getItem("ha-kit-theme-mode");
  const badgeColor = localStorage.getItem("ha-kit-attention-badge-color");
  const legacyTheme = localStorage.getItem("ha-kit-theme");
  if (!themeMode && !badgeColor && !legacyTheme) return null;

  return normalizeAppearance({
    themeMode:
      themeMode === "light" || themeMode === "dark" || themeMode === "system"
        ? themeMode
        : legacyTheme === "light" || legacyTheme === "dark"
          ? legacyTheme
          : undefined,
    badgeColor: badgeColor && isHex(badgeColor) ? badgeColor : undefined,
  });
}

export function applyAppearancePreferences(prefs: AppearanceSettings) {
  const root = document.documentElement;
  root.setAttribute("data-theme", resolveTheme(prefs.themeMode));
  root.setAttribute("data-density", prefs.density);
  root.setAttribute("data-font-scale", prefs.fontScale);
  root.setAttribute("data-status-intensity", prefs.statusIntensity);
  root.toggleAttribute("data-reduce-motion", prefs.reduceMotion);
  root.toggleAttribute("data-hide-nav-badges", prefs.hideNavBadges);
  root.toggleAttribute("data-high-contrast", prefs.highContrast);
  root.style.setProperty("--attention-badge-custom", prefs.badgeColor);
  root.style.setProperty("--primary-custom", prefs.accentColor);
  root.style.setProperty("--primary-hover-custom", `color-mix(in srgb, ${prefs.accentColor} 82%, black)`);
}

export function bootstrapAppearanceFromStorage() {
  const cached = loadCachedAppearance() ?? loadLegacyAppearance();
  if (cached) applyAppearancePreferences(cached);
}
