import type { NavAttentionCounts } from "../lib/navAttention";

export function NavAttentionBadge({ path, counts }: { path: string; counts: NavAttentionCounts }) {
  const count = counts[path as keyof NavAttentionCounts] ?? 0;
  if (count <= 0) return null;

  const label = count > 99 ? "99+" : String(count);

  return (
    <span className="nav-link-badge" aria-label={`${count} item${count === 1 ? "" : "s"} need attention`}>
      {label}
    </span>
  );
}
