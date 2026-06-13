export function Chip({ status, label }: { status: string; label?: string }) {
  return <span className={`chip chip-${status}`}>{label ?? status}</span>;
}
