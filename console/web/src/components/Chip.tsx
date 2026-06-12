export function Chip({ status }: { status: string }) {
  return <span className={`chip chip-${status}`}>{status}</span>;
}
