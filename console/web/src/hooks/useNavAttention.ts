import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  dashboardApi,
  onboardingApi,
  toApiError,
  type DashboardStatus,
  type OnboardingStatus,
  type ProdStoragePreflightResult,
} from "../api";
import { computeNavAttention, type NavAttentionCounts, type NavAttentionItem } from "../lib/navAttention";

const POLL_MS = 30000;

const EMPTY_COUNTS: NavAttentionCounts = {
  "/": 0,
  "/environment": 0,
  "/diagnostics": 0,
  "/operations": 0,
  "/settings": 0,
  "/onboarding": 0,
};

/** Nav badges — entity preflight runs only in DeployLovelaceGatePanel (avoids duplicate scans). */
export function useNavAttention() {
  const [dashboard, setDashboard] = useState<DashboardStatus | null>(null);
  const [onboarding, setOnboarding] = useState<OnboardingStatus | null>(null);
  const [preflight, setPreflight] = useState<ProdStoragePreflightResult | null>(null);
  const inFlightRef = useRef(false);
  const stableRef = useRef<{ items: NavAttentionItem[]; counts: NavAttentionCounts }>({
    items: [],
    counts: EMPTY_COUNTS,
  });

  const publishPreflight = useCallback((result: ProdStoragePreflightResult | null) => {
    setPreflight(result);
  }, []);

  const refresh = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const [dash, onboard] = await Promise.all([dashboardApi.status(), onboardingApi.status()]);
      setDashboard(dash);
      setOnboarding(onboard);
    } catch (e) {
      console.warn("nav attention refresh failed:", toApiError(e).detail);
    } finally {
      inFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), POLL_MS);
    return () => window.clearInterval(id);
  }, [refresh]);

  const computed = useMemo(
    () =>
      dashboard
        ? computeNavAttention({ dashboard, onboarding, preflight })
        : { items: [] as NavAttentionItem[], counts: EMPTY_COUNTS },
    [dashboard, onboarding, preflight],
  );

  if (dashboard) {
    stableRef.current = computed;
  }

  const { items, counts } = dashboard ? computed : stableRef.current;

  return { items, counts, refresh, publishPreflight };
}
