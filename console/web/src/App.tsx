import { useEffect, useState, type ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { onboardingApi, toApiError, type ApiError } from "./api";
import { AppShell } from "./components/AppShell";
import { LoadErrorPanel } from "./components/LoadErrorPanel";
import ActivityPage from "./pages/ActivityPage";
import DashboardEnvironmentPage from "./pages/DashboardEnvironmentPage";
import DashboardLivePage from "./pages/DashboardLivePage";
import DiagnosticsPage from "./pages/DiagnosticsPage";
import OnboardingPage from "./pages/OnboardingPage";
import OperationsPage from "./pages/OperationsPage";
import SettingsPage from "./pages/SettingsPage";

function RequireOnboarding({ children }: { children: ReactNode }) {
  const [complete, setComplete] = useState<boolean | null>(null);
  const [loadError, setLoadError] = useState<ApiError | null>(null);
  const location = useLocation();

  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    onboardingApi
      .status()
      .then((s) => {
        if (!cancelled) setComplete(s.isComplete);
      })
      .catch((e) => {
        if (!cancelled) setLoadError(toApiError(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (complete === null) return;
    let cancelled = false;
    onboardingApi
      .status()
      .then((s) => {
        if (!cancelled) setComplete(s.isComplete);
      })
      .catch(() => {
        /* Keep the current shell mounted on transient errors during navigation. */
      });
    return () => {
      cancelled = true;
    };
  }, [location.pathname, complete]);

  if (loadError) {
    return (
      <LoadErrorPanel
        title="Staging console"
        error={loadError}
        onRetry={() => {
          setLoadError(null);
          setComplete(null);
          onboardingApi
            .status()
            .then((s) => setComplete(s.isComplete))
            .catch((e) => setLoadError(toApiError(e)));
        }}
      />
    );
  }

  if (complete === null) return <div className="shell"><div className="card">Loading…</div></div>;
  if (!complete && location.pathname !== "/onboarding") return <Navigate to="/onboarding" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <RequireOnboarding>
      <Routes>
        <Route path="/onboarding" element={<OnboardingPage />} />
        <Route element={<AppShell />}>
          <Route index element={<DashboardLivePage />} />
          <Route path="environment" element={<DashboardEnvironmentPage />} />
          <Route path="activity" element={<ActivityPage />} />
          <Route path="diagnostics" element={<DiagnosticsPage />} />
          <Route path="operations" element={<OperationsPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </RequireOnboarding>
  );
}
