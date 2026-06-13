export function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";

  const deltaMs = Date.now() - at.getTime();
  const mins = Math.floor(deltaMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function formatRefreshLabel(iso: string | null | undefined): string {
  const rel = formatRelativeTime(iso);
  return rel ? `Updated ${rel}` : "Updated just now";
}
