import type { ComponentIssue } from "../api";
import type { ColoredLogEntry } from "./logLineStyle";
import { issueDomain } from "./haIssueLog";

export type HaIssueInsight = {
  cause: string;
  hints: string[];
};

function combinedContext(issue: ComponentIssue, logEntries?: readonly ColoredLogEntry[]): string {
  const logText = logEntries?.filter((e) => e.match).map((e) => e.text).join("\n") ?? "";
  const reason = issue.reason?.trim() ?? "";
  const fromMessage = issue.message.includes(" — ") ? issue.message.split(" — ").slice(1).join(" — ") : "";
  return `${reason}\n${fromMessage}\n${logText}`.toLowerCase();
}

function oauthCloudHint(integrationLabel: string): string[] {
  return [
    `Open ${integrationLabel} → Settings → Devices & services → find this integration.`,
    "Use Reconfigure, or remove the entry and add it again, then sign in with the cloud account.",
    "Storage sync copies prod OAuth tokens — re-auth once on staging; later syncs preserve allowlisted domains (SmartThings, Tuya).",
  ];
}

export function buildHaIssueInsight(
  issue: ComponentIssue,
  logEntries?: readonly ColoredLogEntry[],
  instanceLabel?: string,
): HaIssueInsight | null {
  const domain = issueDomain(issue);
  const ctx = combinedContext(issue, logEntries);
  const haLabel = instanceLabel?.trim() || (issue.source.includes("Staging") ? "staging Home Assistant" : "production Home Assistant");

  if (/refresh_token\/smartthings|account-link\.nabucasa\.com.*smartthings/.test(ctx)) {
    return {
      cause:
        issue.reason?.trim() ||
        "SmartThings OAuth token refresh failed — Nabu Casa account link rejected the stored credentials (HTTP 400).",
      hints: oauthCloudHint(haLabel),
    };
  }

  if (domain === "tuya" && (/could not authenticate|authentication failed/i.test(ctx) || /tuya.*auth/i.test(ctx))) {
    return {
      cause: issue.reason?.trim() || "Tuya cloud login failed — stored credentials are invalid or expired.",
      hints: oauthCloudHint(haLabel),
    };
  }

  if (/reolink/.test(ctx) && (/login|password|credential|401|403|unauthorized/i.test(ctx))) {
    return {
      cause: issue.reason?.trim() || "Reolink login failed — host, username, or password may be wrong for this environment.",
      hints: [
        `Open ${haLabel} → Settings → Devices & services → Reolink.`,
        "Reconfigure with credentials that work from the staging network (IPs/hostnames may differ from prod).",
        "If you copied prod storage, update the Reolink host to a staging-reachable address.",
      ],
    };
  }

  if (/nabucasa|account-link|oauth|refresh_token|could not authenticate|authentication failed/i.test(ctx)) {
    return {
      cause: issue.reason?.trim() || "Cloud account link or OAuth token is invalid for this Home Assistant instance.",
      hints: oauthCloudHint(haLabel),
    };
  }

  if (/clientconnectorerror|cannot connect|connection refused|name or service not known/i.test(ctx)) {
    return {
      cause: issue.reason?.trim() || "The integration cannot reach its device or service on the network.",
      hints: [
        `Confirm the device or service is online and reachable from ${haLabel === "staging Home Assistant" ? "the staging host" : "production"}.`,
        "Check hostnames and IPs — staging often needs different addresses than prod after storage sync.",
        "Review the log block below for the exact host or URL that failed.",
      ],
    };
  }

  if (/timeout/i.test(ctx)) {
    return {
      cause: issue.reason?.trim() || "The integration timed out while connecting or fetching data.",
      hints: [
        "Verify the target device or API is responding on the network.",
        "Retry after staging HA finishes starting — some integrations fail if polled too early.",
      ],
    };
  }

  const reason = issue.reason?.trim();
  if (reason) {
    return {
      cause: reason,
      hints: [
        `Open ${haLabel} → Settings → Devices & services → locate this integration.`,
        "Try Reconfigure, reload the integration, or restart Home Assistant after fixing credentials or network access.",
        "See matching log lines below for the full traceback.",
      ],
    };
  }

  return null;
}
