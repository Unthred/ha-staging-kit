import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import { useNavAttention } from "../hooks/useNavAttention";
import type { ProdStoragePreflightResult } from "../api";
import type { NavAttentionCounts, NavAttentionItem } from "../lib/navAttention";
import { navAttentionCount, navAttentionForPath } from "../lib/navAttention";

type NavAttentionContextValue = {
  items: NavAttentionItem[];
  counts: NavAttentionCounts;
  itemsForPath: (path: string) => NavAttentionItem[];
  countForPath: (path: string) => number;
  refresh: () => void;
  publishPreflight: (result: ProdStoragePreflightResult | null) => void;
};

const NavAttentionContext = createContext<NavAttentionContextValue | null>(null);

export function NavAttentionProvider({ children }: { children: ReactNode }) {
  const { items, counts, refresh, publishPreflight } = useNavAttention();

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
    }),
    [items, counts, itemsForPath, countForPath, refresh, publishPreflight],
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
