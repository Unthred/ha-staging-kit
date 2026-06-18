import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { settingsApi } from "../api";
import {
  DEFAULT_APPEARANCE,
  appearanceEquals,
  appearanceFromApi,
  applyAppearancePreferences,
  cacheAppearance,
  loadCachedAppearance,
  loadLegacyAppearance,
  normalizeAppearance,
  resolveTheme,
  type AppearanceSettings,
  type FontScale,
  type StatusIntensity,
  type ThemeMode,
  type UiDensity,
} from "../lib/appearancePreferences";

type SaveState = "idle" | "saving" | "saved" | "error";

type AppearanceContextValue = {
  appearance: AppearanceSettings;
  resolvedTheme: "light" | "dark";
  saveState: SaveState;
  setThemeMode: (mode: ThemeMode) => void;
  setBadgeColor: (color: string) => void;
  setAccentColor: (color: string) => void;
  setDensity: (density: UiDensity) => void;
  setFontScale: (scale: FontScale) => void;
  setReduceMotion: (value: boolean) => void;
  setStatusIntensity: (value: StatusIntensity) => void;
  setHideNavBadges: (value: boolean) => void;
  setHighContrast: (value: boolean) => void;
  resetAppearance: () => void;
};

const AppearanceContext = createContext<AppearanceContextValue | null>(null);

function useDebouncedSave(appearance: AppearanceSettings, ready: boolean) {
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const firstRun = useRef(true);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (!ready) return;

    if (firstRun.current) {
      firstRun.current = false;
      return;
    }

    setSaveState("saving");
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      settingsApi
        .saveAppearance(appearance)
        .then(() => setSaveState("saved"))
        .catch(() => setSaveState("error"));
    }, 450);

    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [appearance, ready]);

  return saveState;
}

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [appearance, setAppearance] = useState<AppearanceSettings>(
    () => loadCachedAppearance() ?? loadLegacyAppearance() ?? DEFAULT_APPEARANCE,
  );
  const [ready, setReady] = useState(false);
  const resolvedTheme = resolveTheme(appearance.themeMode);
  const saveState = useDebouncedSave(appearance, ready);

  const apply = useCallback((next: AppearanceSettings) => {
    const normalized = normalizeAppearance(next);
    setAppearance(normalized);
    applyAppearancePreferences(normalized);
    cacheAppearance(normalized);
  }, []);

  useEffect(() => {
    applyAppearancePreferences(appearance);
    cacheAppearance(appearance);
  }, [appearance]);

  useEffect(() => {
    settingsApi
      .get()
      .then((settings) => {
        const server = appearanceFromApi(settings.appearance);
        const cached = loadCachedAppearance() ?? loadLegacyAppearance();
        if (cached && appearanceEquals(server, DEFAULT_APPEARANCE) && !appearanceEquals(cached, DEFAULT_APPEARANCE)) {
          apply(cached);
        } else {
          apply(server);
        }
      })
      .catch(() => {
        /* keep cached / default */
      })
      .finally(() => setReady(true));
  }, [apply]);

  useEffect(() => {
    if (appearance.themeMode !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyAppearancePreferences(appearance);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [appearance]);

  const patch = useCallback(
    (partial: Partial<AppearanceSettings>) => apply({ ...appearance, ...partial }),
    [appearance, apply],
  );

  const setThemeMode = useCallback((mode: ThemeMode) => patch({ themeMode: mode }), [patch]);
  const setBadgeColor = useCallback(
    (color: string) => {
      if (/^#[0-9a-fA-F]{6}$/.test(color)) patch({ badgeColor: color });
    },
    [patch],
  );
  const setAccentColor = useCallback(
    (color: string) => {
      if (/^#[0-9a-fA-F]{6}$/.test(color)) patch({ accentColor: color });
    },
    [patch],
  );
  const setDensity = useCallback((density: UiDensity) => patch({ density }), [patch]);
  const setFontScale = useCallback((fontScale: FontScale) => patch({ fontScale }), [patch]);
  const setReduceMotion = useCallback((reduceMotion: boolean) => patch({ reduceMotion }), [patch]);
  const setStatusIntensity = useCallback(
    (statusIntensity: StatusIntensity) => patch({ statusIntensity }),
    [patch],
  );
  const setHideNavBadges = useCallback((hideNavBadges: boolean) => patch({ hideNavBadges }), [patch]);
  const setHighContrast = useCallback((highContrast: boolean) => patch({ highContrast }), [patch]);
  const resetAppearance = useCallback(() => apply(DEFAULT_APPEARANCE), [apply]);

  const value = useMemo(
    () => ({
      appearance,
      resolvedTheme,
      saveState,
      setThemeMode,
      setBadgeColor,
      setAccentColor,
      setDensity,
      setFontScale,
      setReduceMotion,
      setStatusIntensity,
      setHideNavBadges,
      setHighContrast,
      resetAppearance,
    }),
    [
      appearance,
      resolvedTheme,
      saveState,
      setThemeMode,
      setBadgeColor,
      setAccentColor,
      setDensity,
      setFontScale,
      setReduceMotion,
      setStatusIntensity,
      setHideNavBadges,
      setHighContrast,
      resetAppearance,
    ],
  );

  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>;
}

export function useAppearance() {
  const ctx = useContext(AppearanceContext);
  if (!ctx) throw new Error("useAppearance must be used within AppearanceProvider");
  return ctx;
}
