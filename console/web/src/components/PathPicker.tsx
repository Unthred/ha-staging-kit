import { useCallback, useState } from "react";
import { onboardingApi, toApiError, type BrowseResult } from "../api";

export function PathPicker({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: string;
  onChange: (path: string) => void;
  hint?: string;
}) {
  const [browse, setBrowse] = useState<BrowseResult | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadBrowse = useCallback(async (path?: string) => {
    setBusy(true);
    setError(null);
    try {
      setBrowse(await onboardingApi.browse(path));
    } catch (e) {
      setError(toApiError(e).detail);
    } finally {
      setBusy(false);
    }
  }, []);

  const openBrowser = async () => {
    setOpen(true);
    await loadBrowse(value || undefined);
  };

  return (
    <div className="path-picker">
      <label>
        {label}
        <div className="path-picker-row">
          <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={hint} />
          <button type="button" className="btn secondary" onClick={openBrowser}>
            Browse…
          </button>
        </div>
      </label>

      {open && (
        <div className="browse-panel card">
          <div className="browse-head">
            <strong>Browse directories</strong>
            <button type="button" className="btn ghost" onClick={() => setOpen(false)}>
              Close
            </button>
          </div>
          {busy && <p className="muted">Loading…</p>}
          {error && <p className="msg err">{error}</p>}
          {browse && !busy && (
            <>
              <p className="browse-path">
                {browse.parentPath && (
                  <button type="button" className="btn ghost" onClick={() => loadBrowse(browse.parentPath!)}>
                    ↑ Up
                  </button>
                )}
                <code>{browse.path}</code>
                {browse.isGitRepo && <span className="configured"> git repo</span>}
              </p>
              {browse.error && <p className="msg err">{browse.error}</p>}
              <ul className="browse-list">
                {browse.entries.map((e) => (
                  <li key={e.path}>
                    {e.isDirectory ? (
                      <button type="button" className="browse-dir" onClick={() => loadBrowse(e.path)}>
                        📁 {e.name}/
                      </button>
                    ) : (
                      <span className="browse-file">
                        📄 {e.name}
                        {e.badge && <span className="muted"> ({e.badge})</span>}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
              <button type="button" className="btn primary" onClick={() => { onChange(browse.path); setOpen(false); }}>
                Use this folder
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
