import { Link } from "react-router-dom";
import { KIT_FQDN } from "../../lib/kitHosts";

export function StagingTokenRefreshHelp({ stagingUrl }: { stagingUrl?: string | null }) {
  const haUrl = stagingUrl?.trim() || null;

  return (
    <div className="diag-token-help">
      <p className="diag-token-help-lead">
        The kit cannot read staging integration status until a valid long-lived token is saved. This usually happens
        after an old storage sync copied prod auth (fixed now) or if the token was revoked in staging HA.
      </p>

      <h4 className="diag-token-help-heading">1. Create a token in staging Home Assistant</h4>
      <ol className="diag-token-help-steps">
        <li>
          Open staging HA
          {haUrl ? (
            <>
              {" "}
              at{" "}
              <a href={haUrl} target="_blank" rel="noreferrer">
                {haUrl}
              </a>
            </>
          ) : (
            " in your browser (same URL as in kit Settings → Staging connection)"
          )}
          .
        </li>
        <li>
          Click your <strong>profile name</strong> at the bottom of the sidebar → <strong>Security</strong> →{" "}
          <strong>Long-lived access tokens</strong>.
        </li>
        <li>
          Select <strong>Create token</strong>, name it e.g. <code>ha-staging-kit</code>, and confirm.
        </li>
        <li>
          <strong>Copy the token immediately</strong> — Home Assistant shows it only once. If you lose it, create
          another token.
        </li>
      </ol>

      <h4 className="diag-token-help-heading">2. Save it in the staging kit</h4>
      <ol className="diag-token-help-steps">
        <li>
          Go to{" "}
          <Link to="/settings?section=staging">Settings → Staging connection</Link> in this console.
        </li>
        <li>
          Confirm <strong>Staging HA URL</strong> matches where staging is reachable from the kit (e.g.{" "}
          <code>{KIT_FQDN.stagingHa}</code> with split DNS, or a direct LAN URL if you prefer).
        </li>
        <li>
          Paste the token into <strong>Staging write token</strong> and click <strong>Save settings</strong> at the
          bottom of the page.
        </li>
        <li>
          Use <strong>Test staging API</strong> on that page — you should see a success message.
        </li>
        <li>
          Return here, refresh Diagnostics, and open the <strong>Staging</strong> tab — integration issues should
          list again.
        </li>
      </ol>

      <p className="muted diag-token-help-note">
        Restarting staging HA alone does not invalidate tokens anymore (auth is not copied during storage sync). If
        Test staging API still fails, check the URL and that staging HA is running.
      </p>
    </div>
  );
}
