import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import { useNavAttention } from "../hooks/useNavAttention";
import type { ApiError, ProdStoragePreflightResult } from "../api";
import type { NavAttentionCounts, NavAttentionItem } from "../lib/navAttention";
import { navAttentionCount, navAttentionForPath } from "../lib/navAttention";

type NavAttentionContextValue = {
  items: NavAttentionItem[];
  counts: NavAttentionCounts;
  itemsForPath: (path: string) => NavAttentionItem[];
  countForPath: (path: string) => number;
  refresh: () => void;
  publishPreflight: (result: ProdStoragePreflightResult | null) => void;
  invalidatePreflight: () => void;
  runPreflight: (options?: { force?: boolean }) => Promise<ProdStoragePreflightResult>;
  preflight: ProdStoragePreflightResult | null;
  preflightBusy: boolean;
  preflightError: ApiError | null;
  preflightScannedAt: number | null;
};

const NavAttentionContext = createContext<NavAttentionContextValue | null>(null);

export function NavAttentionProvider({ children }: { children: ReactNode }) {
  const {
    items,
    counts,
    refresh,
    publishPreflight,
    invalidatePreflight,
    runPreflight,
    preflight,
    preflightBusy,
    preflightError,
    preflightScannedAt,
  } = useNavAttention();

  const itemsForPath = useCallback((path: string) => navAttentionForPath(items, path), [items]);
  const countForPath = useCallback((path: string) => navAttentionCount(items, path), [items]);

  const value = useMemo<NavAttentionContextValue>(
    () => ({
      items,
      counts,
      itemsForPath,
      countForPath,
      refresh,
      publishPreflight,
      invalidatePreflight,
      runPreflight,
      preflight,
      preflightBusy,
      preflightError,
      preflightScannedAt,
    }),
    [
      items,
      counts,
      itemsForPath,
      countForPath,
      refresh,
      publishPreflight,
      invalidatePreflight,
      runPreflight,
      preflight,
      preflightBusy,
      preflightError,
      preflightScannedAt,
    ],
  );

  return <NavAttentionContext.Provider value={value}>{children}</NavAttentionContext.Provider>;
}

export function useNavAttentionContext(): NavAttentionContextValue {
  const ctx = useContext(NavAttentionContext);
  if (!ctx) {
    throw new Error("useNavAttentionContext must be used within NavAttentionProvider");
  }
  return ctx;
}
