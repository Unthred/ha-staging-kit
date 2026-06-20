# Release architecture — work roadmap

**Status:** Planning — tracked on [ha-staging-kit](https://github.com/users/Unthred/projects/4).  
**Epic:** [ha-staging-kit #9](https://github.com/Unthred/ha-staging-kit/issues/9)  
**Principles:** [architecture.md](architecture.md)

## Problem

Today the kit uses **three parallel paths**:

| Path | What moves | Through git? |
|------|------------|--------------|
| Git deploy | YAML + selected `.storage` bundle | Partially |
| Storage sync | Prod `.storage` → staging | No |
| Kit SSH | Registry fixes, deploy-to-prod | No |

Target: **kit writes git + migration artifacts**; **release agent applies to prod**; prod read-only during review.

## Work streams

### A. Migration manifest (git artifacts)

- [x] [#10](https://github.com/Unthred/ha-staging-kit/issues/10) Spec: migration manifest format — [design-migration-manifest.md](design-migration-manifest.md) + schema + examples
- [x] [#11](https://github.com/Unthred/ha-staging-kit/issues/11) Kit: export migration from deploy gate **and** naming scan (manifest + git patches, not SSH fix)
- [ ] [#12](https://github.com/Unthred/ha-staging-kit/issues/12) Pilot migrations — **deferred** until #14 (no E2E without release agent)
- [ ] [#12](https://github.com/Unthred/ha-staging-kit/issues/12) Pilot: `zaphod_shield_3` → `zaphod_shield_cast` (Lovelace git fix)
- [ ] [#12](https://github.com/Unthred/ha-staging-kit/issues/12) Pilot: `timer.wee_bear_boost_timer` registry rename

### B. Release agent (outside HA)

- [ ] [#13](https://github.com/Unthred/ha-staging-kit/issues/13) Design: [design-release-agent.md](design-release-agent.md) — triggers, apply order, idempotency, rollback — **done**
- [ ] [#14](https://github.com/Unthred/ha-staging-kit/issues/14) MVP: watch approved `main` SHA → checkout → run migrations → apply YAML + `.storage` → reload/restart prod — **next**
- [ ] [#14](https://github.com/Unthred/ha-staging-kit/issues/14) Packaging: systemd / Windows Service / Docker / GitHub runner (same core logic)

### C. Converge kit UI (deprecate shortcuts)

- [ ] [#15](https://github.com/Unthred/ha-staging-kit/issues/15) Hide or gate **Fix entity id on prod** / **Fix suffix** — replace with “Export migration” — **phase 1 shipped** (prod-writes lock + export path; full deprecation after #14)
- [ ] [#15](https://github.com/Unthred/ha-staging-kit/issues/15) Replace **Deploy to prod** with “Request release” → release agent (keep SSH deploy behind dev flag until MVP)
- [ ] [#15](https://github.com/Unthred/ha-staging-kit/issues/15) Enforce prod read-only messaging in deploy gate during review

### D. Authority & hygiene

- [ ] [#16](https://github.com/Unthred/ha-staging-kit/issues/16) Git Lovelace authority: strategy for 46 post-baseline deploy blockers (capture prod → git vs prune stale refs)
- [ ] [#17](https://github.com/Unthred/ha-staging-kit/issues/17) Fix `SidecarRunner` 5s timeout — reset workbench / apply-config must complete from UI
- [ ] Sidecar CRLF guard — `preserve-staging-oauth-entries.sh` fixed locally; add lint or normalize on deploy

### E. Database (recorder)

- [ ] [#18](https://github.com/Unthred/ha-staging-kit/issues/18) Diagnostics panel: engine, size, integrity, recorder errors (prod + staging)
- [ ] [#19](https://github.com/Unthred/ha-staging-kit/issues/19) Engine wizard: SQLite → MariaDB/PostgreSQL — staging-first, release agent to prod

## Done (baseline prep)

- [x] Baseline reset — `staging` = `main` @ `505ff53`, storage sync, sidecar WIP cleared (2026-06-20)
- [x] Migration manifest spec + kit export (#10, #11) — deployed 2026-06-20
- [x] Prod-writes lock + Operations entity deploy gate UX (#15 phase 1)
- [x] Architecture principles documented — [architecture.md](architecture.md), [plan-staging-prod-baseline.md](plan-staging-prod-baseline.md)

## Related

- [checkpoint-2026-06-20-staging-baseline-and-architecture.md](checkpoint-2026-06-20-staging-baseline-and-architecture.md)
- [design-entity-deploy-scan.md](design-entity-deploy-scan.md)
- [backlog.md](backlog.md)
