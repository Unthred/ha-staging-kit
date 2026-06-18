/** Muted one-liner under an Operations section action area. */
export function OpsLastRunLine({ when, detail }: { when?: string | null; detail?: string | null }) {
  const label = when?.trim() ? when : "Never";
  return (
    <p className="muted ops-last-run">
      Last run: <span className="ops-last-run-when">{label}</span>
      {detail ? <> · {detail}</> : null}
    </p>
  );
}
