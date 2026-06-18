import { NavLink, Outlet } from "react-router-dom";
import { NavAttentionProvider, useNavAttentionContext } from "../context/NavAttentionContext";
import { useBootstrapHaUrls } from "../hooks/useBootstrapHaUrls";
import { NavAttentionBadge } from "./NavAttentionBadge";

const links = [
  { to: "/", label: "Overview", end: true },
  { to: "/environment", label: "Environment" },
  { to: "/diagnostics", label: "Diagnostics" },
  { to: "/operations", label: "Operations" },
  { to: "/settings", label: "Settings" },
  { to: "/onboarding", label: "Setup wizard" },
];

function AppShellFrame() {
  const { counts } = useNavAttentionContext();
  useBootstrapHaUrls();

  return (
    <div className="shell app-shell">
      <header className="top-nav">
        <span className="top-nav-app-name">ha-staging-kit</span>
        <nav className="top-nav-right">
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.end}
              className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}
            >
              <span className="nav-link-label">{l.label}</span>
              <NavAttentionBadge path={l.to} counts={counts} />
            </NavLink>
          ))}
        </nav>
      </header>
      <Outlet />
    </div>
  );
}

export function AppShell() {
  return (
    <NavAttentionProvider>
      <AppShellFrame />
    </NavAttentionProvider>
  );
}
