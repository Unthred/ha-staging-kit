import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { settingsApi, type ReleaseSafetyView } from "../api";

const DEFAULT_LOCK_MESSAGE =
  "Prod writes are locked. Diagnose and review on staging only. Enable in Settings → Release safety when you intentionally need legacy prod SSH.";

type ReleaseSafetyContextValue = {
  prodWritesEnabled: boolean;
  prodWritesLocked: boolean;
  lockMessage: string;
  loaded: boolean;
  refresh: () => Promise<void>;
  setProdWritesEnabled: (enabled: boolean) => Promise<ReleaseSafetyView>;
};

const ReleaseSafetyContext = createContext<ReleaseSafetyContextValue | null>(null);

export function ReleaseSafetyProvider({ children }: { children: ReactNode }) {
  const [view, setView] = useState<ReleaseSafetyView | null>(null);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    const settings = await settingsApi.get();
    setView(settings.releaseSafety);
    setLoaded(true);
  }, []);

  useEffect(() => {
    refresh().catch(() => setLoaded(true));
  }, [refresh]);

  const setProdWritesEnabled = useCallback(async (enabled: boolean) => {
    const next = await settingsApi.saveReleaseSafety(enabled);
    setView(next);
    return next;
  }, []);

  const value = useMemo<ReleaseSafetyContextValue>(
    () => ({
      prodWritesEnabled: view?.prodWritesEnabled ?? false,
      prodWritesLocked: !(view?.prodWritesEnabled ?? false),
      lockMessage: view?.lockMessage ?? DEFAULT_LOCK_MESSAGE,
      loaded,
      refresh,
      setProdWritesEnabled,
    }),
    [view, loaded, refresh, setProdWritesEnabled],
  );

  return <ReleaseSafetyContext.Provider value={value}>{children}</ReleaseSafetyContext.Provider>;
}

export function useReleaseSafety() {
  const ctx = useContext(ReleaseSafetyContext);
  if (!ctx) {
    throw new Error("useReleaseSafety must be used within ReleaseSafetyProvider");
  }
  return ctx;
}
