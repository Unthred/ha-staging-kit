import { Link } from "react-router-dom";
import { useReleaseSafety } from "../context/ReleaseSafetyContext";

export function ReleaseSafetyBanner() {
  const { prodWritesLocked, lockMessage, loaded } = useReleaseSafety();

  if (!loaded || !prodWritesLocked) return null;

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
        Entity deploy gate
      </Link>
    </div>
  );
}
