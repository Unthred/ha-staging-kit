export function DashboardOpenLinks({
  stagingUrl,
  prodUrl,
}: {
  stagingUrl?: string | null;
  prodUrl?: string | null;
}) {
  if (!stagingUrl && !prodUrl) return null;

  return (
    <div className="dash-open-links">
      {prodUrl && (
        <a href={prodUrl} target="_blank" rel="noreferrer" className="dash-chip-link">
          Open production HA
        </a>
      )}
      {stagingUrl && (
        <a href={stagingUrl} target="_blank" rel="noreferrer" className="dash-chip-link">
          Open staging HA
        </a>
      )}
    </div>
  );
}
