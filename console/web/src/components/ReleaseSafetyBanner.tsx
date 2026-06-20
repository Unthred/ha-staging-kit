import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useReleaseSafety } from "../context/ReleaseSafetyContext";

const DISMISS_KEY = "ha-staging-kit.release-safety-banner.dismissed";

export function ReleaseSafetyBanner() {
  const { prodWritesLocked, lockMessage, loaded } = useReleaseSafety();
  const [dismissed, setDismissed] = useState(
    () => typeof sessionStorage !== "undefined" && sessionStorage.getItem(DISMISS_KEY) === "1",
  );

  useEffect(() => {
    if (!prodWritesLocked) {
      sessionStorage.removeItem(DISMISS_KEY);
      setDismissed(false);
    }
  }, [prodWritesLocked]);

  if (!loaded || !prodWritesLocked || dismissed) return null;

  return (
    <div className="release-safety-banner" role="status">
      <strong>Prod writes locked</strong>
      <span>{lockMessage}</span>
      <Link to="/settings?section=release-safety" className="release-safety-banner-link">
        Release safety settings
      </Link>
      <Link to="/#deploy-flow-panel" className="release-safety-banner-link">
        Request release on Overview
      </Link>
      <Link to="/operations?section=entity-deploy" className="release-safety-banner-link">
        Entity Janitor
      </Link>
      <button
        type="button"
        className="release-safety-banner-close"
        aria-label="Dismiss prod writes locked banner"
        title="Dismiss for this session"
        onClick={() => {
          sessionStorage.setItem(DISMISS_KEY, "1");
          setDismissed(true);
        }}
      >
        ×
      </button>
    </div>
  );
}
