# ha-staging-kit — backlog

Open items to batch before implementing. Add new issues here as they come up.

## Onboarding / UX

- [x] **Remove "Deploy kit" wizard step** — redundant once the UI is reachable (container already running). Onboarding should be configure + run scripts (storage sync, deploy mirror), not Docker rebuild/redeploy. Rebuild belongs on the host for first install and kit upgrades only.
- [x] **Onboarding wizard (web)** — topology, paths, prod/staging, storage sync, unified MQTT mirror step, health checks with progress, auto-detect, toasts. Shipped 2026-06-13.

## Prod deploy

- [ ] **Webhook/automation-based prod deploy** — alternative to SSH for installs where SSH is not available (HAOS without the SSH add-on, managed Docker hosts). Kit calls a HA webhook that triggers a `shell_command` / script running `git pull` locally on prod HA. Requires a one-time helper automation installed in prod. SSH-based deploy is the only supported path today.

## Dashboard (next)

- [ ] **Dashboard polish** — align day-two UX with wizard (toasts, staging target summary, clearer suggested actions)
- [ ] **Dashboard metrics** — last storage sync / apply / person poll from sync.log (partially wired)
- [ ] **Quick actions** — friendly toasts for apply + person poll (same pattern as wizard)
