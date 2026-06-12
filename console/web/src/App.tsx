import { useEffect, useState, type ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { onboardingApi } from "./api";
import { AppShell } from "./components/AppShell";
import DashboardPage from "./pages/DashboardPage";
import OnboardingPage from "./pages/OnboardingPage";
import OperationsPage from "./pages/OperationsPage";
import SettingsPage from "./pages/SettingsPage";

function RequireOnboarding({ children }: { children: ReactNode }) {
  const [complete, setComplete] = useState<boolean | null>(null);
  const location = useLocation();

  useEffect(() => {
    onboardingApi
      .status()
      .then((s) => setComplete(s.isComplete))
      .catch(() => setComplete(true));
  }, [location.pathname]);

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
