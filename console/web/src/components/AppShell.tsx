import { NavLink, Outlet } from "react-router-dom";

const links = [
  { to: "/", label: "Overview", end: true },
  { to: "/environment", label: "Environment" },
  { to: "/diagnostics", label: "Diagnostics" },
  { to: "/operations", label: "Operations" },
  { to: "/settings", label: "Settings" },
  { to: "/onboarding", label: "Setup wizard" },
];

export function AppShell() {
  return (
    <div className="shell app-shell">
      <header className="top-nav">
        <div>
          <p className="eyebrow">ha-staging-kit</p>
          <h1>Staging console</h1>
        </div>
        <nav className="top-links">
          {links.map((l) => (
            <NavLink key={l.to} to={l.to} end={l.end} className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}>
              {l.label}
            </NavLink>
          ))}
        </nav>
      </header>
      <Outlet />
    </div>
  );
}
