import type { DashboardStatus } from "../../api";
import { formatRelativeTime } from "../../lib/formatTime";

type ActivityItem = {
  id: string;
  label: string;
  value: string;
  when?: string;
  tone: "neutral" | "active";
};

function extractWhen(text: string): string | undefined {
  const m = text.match(/^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\]/);
  if (!m) return undefined;
  const d = new Date(m[1].replace(" ", "T"));
  return Number.isNaN(d.getTime()) ? undefined : formatRelativeTime(d.toISOString());
}

function stripTimestamp(text: string): string {
  return text.replace(/^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\]\s*/, "").replace(/^ha-staging-kit-sync:\s*/, "");
}

function buildItems(data: DashboardStatus): ActivityItem[] {
  const items: ActivityItem[] = [];

  if (data.personSync?.lastCount != null) {
    items.push({
      id: "person",
      label: "Person sync",
      value: `${data.personSync.lastCount} states mirrored`,
      when: data.personSync.lastAtRelative ?? (data.personSync.lastAt ? formatRelativeTime(data.personSync.lastAt) : undefined),
      tone: "active",
    });
  } else if (data.sidecar?.lastPersonSync) {
    items.push({
      id: "person",
      label: "Person sync",
      value: stripTimestamp(data.sidecar.lastPersonSync),
      when: extractWhen(data.sidecar.lastPersonSync),
      tone: "active",
    });
  }

  if (data.sidecar?.lastApply) {
    items.push({
      id: "apply",
      label: "Config apply",
      value: stripTimestamp(data.sidecar.lastApply),
      when: extractWhen(data.sidecar.lastApply),
      tone: "active",
    });
  }

  if (data.sidecar?.lastStorageSync) {
    items.push({
      id: "storage",
      label: "Storage sync",
      value: stripTimestamp(data.sidecar.lastStorageSync),
      when: extractWhen(data.sidecar.lastStorageSync),
      tone: "neutral",
    });
  }

  if (data.sidecar) {
    items.push({
      id: "poll-interval",
      label: "Poll cadence",
      value: `Every ${data.sidecar.personPollIntervalSeconds}s`,
      tone: "neutral",
    });
  }

  return items;
}

export function DashboardActivityFeed({ data }: { data: DashboardStatus }) {
  const items = buildItems(data);

  return (
    <section className="dash-panel dash-activity">
      <header className="dash-panel-head">
        <div>
          <p className="dash-panel-eyebrow">Sync activity</p>
          <h3>Recent pipeline events</h3>
        </div>
      </header>

      {items.length === 0 ? (
        <p className="dash-empty">No sync activity logged yet — the loop may still be starting.</p>
      ) : (
        <ul className="dash-activity-list">
          {items.map((item) => (
            <li key={item.id} className={`dash-activity-item dash-activity-${item.tone}`}>
              <span className="dash-activity-dot" aria-hidden="true" />
              <div>
                <div className="dash-activity-row">
                  <span className="dash-activity-label">{item.label}</span>
                  {item.when && <span className="dash-activity-when">{item.when}</span>}
                </div>
                <span className="dash-activity-value">{item.value}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
