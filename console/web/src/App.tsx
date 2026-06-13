import { useEffect, useState, type ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { onboardingApi, toApiError, type ApiError } from "./api";
import { AppShell } from "./components/AppShell";
import { LoadErrorPanel } from "./components/LoadErrorPanel";
import DashboardPage from "./pages/DashboardPage";
import OnboardingPage from "./pages/OnboardingPage";
import OperationsPage from "./pages/OperationsPage";
import SettingsPage from "./pages/SettingsPage";

function RequireOnboarding({ children }: { children: ReactNode }) {
  const [complete, setComplete] = useState<boolean | null>(null);
  const [loadError, setLoadError] = useState<ApiError | null>(null);
  const location = useLocation();

  const check = () => {
    setLoadError(null);
    setComplete(null);
    onboardingApi
      .status()
      .then((s) => setComplete(s.isComplete))
      .catch((e) => setLoadError(toApiError(e)));
  };

  useEffect(() => {
    check();
  }, [location.pathname]);

  if (loadError) {
    return <LoadErrorPanel title="Staging console" error={loadError} onRetry={check} />;
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
          <Route index element={<DashboardPage />} />
          <Route path="operations" element={<OperationsPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </RequireOnboarding>
  );
}
