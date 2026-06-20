import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  dashboardApi,
  onboardingApi,
  operationsApi,
  toApiError,
  type ApiError,
  type DashboardStatus,
  type OnboardingStatus,
  type ProdStoragePreflightResult,
} from "../api";
import { computeNavAttention, type NavAttentionCounts, type NavAttentionItem } from "../lib/navAttention";

const POLL_MS = 30000;
export const PREFLIGHT_CACHE_MS = 90_000;

const EMPTY_COUNTS: NavAttentionCounts = {
  "/": 0,
  "/environment": 0,
  "/diagnostics": 0,
  "/operations": 0,
  "/settings": 0,
  "/onboarding": 0,
};

export function isPreflightCacheFresh(scannedAt: number | null, maxAgeMs = PREFLIGHT_CACHE_MS): boolean {
  return scannedAt != null && Date.now() - scannedAt < maxAgeMs;
}

/** Nav badges — entity preflight scan is shared across Overview and Operations. */
export function useNavAttention() {
  const [dashboard, setDashboard] = useState<DashboardStatus | null>(null);
  const [onboarding, setOnboarding] = useState<OnboardingStatus | null>(null);
  const [preflight, setPreflight] = useState<ProdStoragePreflightResult | null>(null);
  const [preflightBusy, setPreflightBusy] = useState(false);
  const [preflightError, setPreflightError] = useState<ApiError | null>(null);
  const [preflightScannedAt, setPreflightScannedAt] = useState<number | null>(null);
  const dashboardRefreshInFlightRef = useRef(false);
  const preflightInFlightRef = useRef<Promise<ProdStoragePreflightResult> | null>(null);
  const stableRef = useRef<{ items: NavAttentionItem[]; counts: NavAttentionCounts }>({
    items: [],
    counts: EMPTY_COUNTS,
  });

  const publishPreflight = useCallback((result: ProdStoragePreflightResult | null) => {
    setPreflight(result);
    setPreflightScannedAt(result ? Date.now() : null);
    if (result) setPreflightError(null);
  }, []);

  const invalidatePreflight = useCallback(() => {
    setPreflight(null);
    setPreflightScannedAt(null);
    setPreflightError(null);
  }, []);

  const runPreflight = useCallback(
    async (options?: { force?: boolean }) => {
      if (preflightInFlightRef.current && !options?.force) {
        return preflightInFlightRef.current;
      }

      if (!options?.force && preflight && isPreflightCacheFresh(preflightScannedAt)) {
        return preflight;
      }

      setPreflightBusy(true);
      setPreflightError(null);

      const promise = operationsApi
        .prodStoragePreflight()
        .then((result) => {
          publishPreflight(result);
          return result;
        })
        .catch((err) => {
          const apiError = toApiError(err);
          publishPreflight(null);
          setPreflightError(apiError);
          throw apiError;
        })
        .finally(() => {
          setPreflightBusy(false);
          preflightInFlightRef.current = null;
        });

      preflightInFlightRef.current = promise;
      return promise;
    },
    [preflight, preflightScannedAt, publishPreflight],
  );

  const refresh = useCallback(async () => {
    if (dashboardRefreshInFlightRef.current) return;
    dashboardRefreshInFlightRef.current = true;
    try {
      const [dash, onboard] = await Promise.all([dashboardApi.status(), onboardingApi.status()]);
      setDashboard(dash);
      setOnboarding(onboard);
    } catch (e) {
      console.warn("nav attention refresh failed:", toApiError(e).detail);
    } finally {
      dashboardRefreshInFlightRef.current = false;
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

  return {
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
  };
}
