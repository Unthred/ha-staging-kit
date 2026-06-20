# Release agent

**Status:** Design for [ha-staging-kit #13](https://github.com/Unthred/ha-staging-kit/issues/13)  
**Implementation:** [ha-staging-kit #14](https://github.com/Unthred/ha-staging-kit/issues/14)  
**Related:** [architecture.md](architecture.md) · [design-migration-manifest.md](design-migration-manifest.md) · [design-entity-deploy-scan.md](design-entity-deploy-scan.md)

---

## Purpose

The **release agent** is a process **outside Home Assistant Core** that applies an **approved git release** to **prod**:

1. Run pending **migration manifests** (`migrations/pending/*.yaml`) — registry edits and coordinated file renames on prod disk.
2. Apply **git config** from `main` — YAML packages plus the scoped Lovelace/helper `.storage` bundle.
3. **Reload or restart** prod Core and record what ran.

Today the kit performs steps 2–3 via SSH inside `OperationsService.DeployToProdInternalAsync` (#15 WIP). Registry fixes still use ad-hoc kit SSH buttons. The release agent **replaces both** with one audited pipeline driven by git artifacts.

The kit **exports** migrations (#11). The release agent **executes** them. Pilots (#12) and full E2E validation wait on #14.

---

## Non-goals (MVP)

| Out of scope | Notes |
|--------------|-------|
| Staging apply | Kit sidecar + apply-config remain unchanged |
| Storage sync prod → staging | Separate kit operation |
| OAuth / re-pair flows | Document manual steps; agent does not drive vendor UIs |
| Automatic merge staging → main | Kit ship wizard / git promotion stays in kit until #15 converges UI |
| Multi-instance fleet | One prod target per agent config (future: multiple profiles) |

---

## Placement

```
┌─────────────────────┐     writes git      ┌──────────────────────────┐
│  ha-staging-kit     │ ──────────────────► │  HA config repo (git)    │
│  (console + sidecar)│   staging → main    │  YAML + migrations/      │
└─────────┬───────────┘                     └────────────┬─────────────┘
          │ read-only prod                               │
          │ approve / request release                    │ checkout @ SHA
          ▼                                              ▼
┌─────────────────────┐                     ┌──────────────────────────┐
│  User               │ ─── triggers ─────► │  Release agent (#14)     │
└─────────────────────┘                     │  CLI / service / CI job  │
                                            └────────────┬─────────────┘
                                                         │ SSH + HA API
                                                         ▼
                                            ┌──────────────────────────┐
                                            │  Prod Home Assistant     │
                                            └──────────────────────────┘
```

**Code location (MVP):** new package in this repo, e.g. `release-agent/` (language TBD in #14 — reuse C# services from console where practical, or shell orchestrating existing sidecar patterns).

**Config repo:** migration files and apply ledger live under `migrations/` in **Unthred/HomeAssistant** (workspace `config-repo/`). Agent reads them from the checked-out tree at the release SHA.

---

## Triggers

| Trigger | MVP | Later |
|---------|-----|-------|
| **Manual CLI** | `release-agent apply --ref origin/main` | Primary operator path during build-out |
| **Kit “Request release”** | Kit shells out or POSTs to local agent HTTP (same host as kit) | Replaces “Deploy to prod” (#15) |
| **GitHub Actions** | Extend `ha-prod-deploy.sh` or call agent after merge to `main` | Self-hosted runner with SSH to prod |
| **Poll / webhook** | Not MVP | Watch `main` for new SHA + optional approval file |

**Approval model (MVP):** human runs CLI or clicks Request release after kit deploy-gate scan passes. Agent refuses if preflight fails (see below).

**Future:** signed release record in git (e.g. `releases/approved/<sha>.yaml` with approver + timestamp) before apply.

---

## Inputs

| Input | Source |
|-------|--------|
| Git ref | `main` @ SHA (full SHA recorded in ledger) |
| Config tree | Sparse checkout / full clone at ref — same paths as kit deploy |
| Pending migrations | `migrations/pending/*.yaml` at that ref |
| Prod target | SSH user/host, config path, API URL + token (from env or kit secrets layout) |
| Apply ledger | `migrations/applied/` on prod disk or in git (see Idempotency) |
| Last deploy SHA | `last-prod-deploy.sha` (compat alias — see Release history) |
| Release history | Ordered ledger of every prod release (required for multi-rollback) |

Environment variables align with kit: `HA_SSH`, `HA_CONFIG`, `PROD_HA_URL`, prod token file path, etc.

---

## Release pipeline (apply order)

Single transaction per release attempt. On failure: stop, leave prod in last consistent state, emit structured log.

```
1. Resolve ref → full SHA; fetch if needed
2. Validate all migrations/pending/*.yaml (JSON Schema)
3. Preflight (read-only):
   - Entity deploy scan on git tree @ SHA (reuse ProdStorageDeployService logic)
   - For each pending manifest: evaluate preconditions on prod
   - Fail release if any blocking issue (same policy as kit deploy gate)
4. Idempotency filter: drop manifests whose metadata.id already in ledger
5. If any registry step remains OR spec.stopHomeAssistant:
   - Backup prod .storage/core.entity_registry (+ optional core.device_registry)
   - Stop prod Core; wait until API unreachable
6. For each pending manifest (sorted by filename, stable order):
   - Re-check preconditions
   - Run steps in order (see design-migration-manifest.md)
   - Append ledger entry on success
7. Git config deploy (reuse kit behaviour):
   - Rsync/sparse-deploy YAML from tree (exclude live secrets, full .storage)
   - Deploy changed Lovelace/helper .storage paths from git bundle only
8. Start prod Core if stopped
9. Reload or restart:
   - YAML-only → ha core reload (or equivalent)
   - .storage bundle changed → restart Core (matches kit today)
10. Append **release record** to history (see Release history); update compat `last-prod-deploy.sha` / `last-prod-deploy-previous.sha`
11. Commit git audit artifacts: move manifests `pending/` → `applied/`; append `releases/records/<sha>.yaml` on `main` (agent or kit follow-up commit)
```

**Order rationale:** registry edits must happen while Core is stopped (same as `ProdEntitySuffixFixService`). Git `.storage` bundle must match entity ids **after** registry steps. `config.replace_entity_id` steps in manifests either run on prod disk during step 6 or are already satisfied by git tree at step 7 — agent runs manifest steps on **prod disk** when `paths` refer to live config, and on **release tree** when applying before rsync (MVP: **prod disk** after checkout content is known; git-exported patches are already on `main` at step 7).

**Simpler MVP rule:** manifest `config.replace_entity_id` steps are **no-ops on prod** if git @ SHA already contains the replacement (export #11 committed them). Agent still validates `file_contains_entity` preconditions against the release tree. Registry steps always run on prod.

---

## Step execution (reuse kit)

| Manifest action | Kit implementation today | Agent reuse |
|-----------------|-------------------------|-------------|
| `registry.suffix_collision_fix` | `ProdEntitySuffixFixService.FixSuffixCollisionAsync` | Extract shared library or invoke same SSH/Python as sidecar |
| `registry.rename_entity` | `FixWrongEntityIdAsync` | Same |
| `registry.purge_deleted_tombstones` | `ProdDeletedRegistryPurgeService` | Same |
| `config.replace_entity_id` | `ConfigEntityFixer.ApplyReplaceInPaths` | Prod disk or verify git tree |

Stop/start prod: reuse `OperationsService` SSH helpers (`StopProdHaAsync`, `RestartProdHaAsync`).

---

## Idempotency

**Ledger key:** `metadata.id` (kebab-case, stable forever).

**Ledger location (MVP):** on prod host, outside HA config git:

```
/sidecar-data/migrations-applied.json
```

or under kit `SidecarData`:

```json
{
  "instanceId": "<core.config instance_id>",
  "entries": [
    {
      "id": "squigglebear-tv-suffix-collision",
      "gitSha": "505ff53…",
      "appliedAt": "2026-06-20T12:00:00Z",
      "manifestPath": "migrations/pending/squigglebear-tv-suffix-collision.yaml"
    }
  ]
}
```

**Rules:**

- Before running a manifest, skip if `id` already in ledger **for this prod instanceId**.
- Re-run of same release SHA: all manifests skipped → proceed to git deploy only.
- Changing a manifest file in git after apply requires a **new** `metadata.id` (never edit in place once applied).

**Git `migrations/applied/`:** mirror in config-repo after each successful release — part of the git audit trail (see Release history). Pending manifests move here when applied; never delete applied manifests from git history.

---

## Release history (required)

Every prod deploy is **one ordered release** with enough data to restore prod to that exact point — and to roll back **one or many** releases.

### Principle

| Layer | Rollback source |
|-------|-----------------|
| YAML, packages, Z2M config | Git tree @ release SHA (always in git) |
| Lovelace / helper `.storage` bundle | Same git SHA (paths recorded per release) |
| Entity registry (and related `.storage` touched by migrations) | **Per-release snapshot** on prod disk (not in git — too large / live) |
| Migration scripts | Manifest YAML in git (`migrations/applied/`) + migration id ledger |

Config-only releases need only git. Releases that ran registry migrations need **both** git @ SHA **and** the registry snapshot stored for that release.

### Runtime ledger (authoritative for rollback)

File: `/sidecar-data/release-history.json` (kit `SidecarData`, agent-owned):

```json
{
  "instanceId": "<core.config instance_id>",
  "releases": [
    {
      "index": 1,
      "sha": "505ff53deadbeef…",
      "shortSha": "505ff53",
      "appliedAt": "2026-06-20T10:00:00Z",
      "gitRef": "origin/main",
      "message": "Merge staging: SquiggleBear migration",
      "migrationsApplied": ["squigglebear-tv-suffix-collision"],
      "yamlDeployed": true,
      "storageBundlePaths": [".storage/lovelace.lovelace", ".storage/timer"],
      "registrySnapshot": "/sidecar-data/release-snapshots/505ff53/core.entity_registry",
      "deviceRegistrySnapshot": "/sidecar-data/release-snapshots/505ff53/core.device_registry",
      "reportPath": "/sidecar-data/release-reports/505ff53.json"
    }
  ],
  "currentIndex": 1
}
```

**Rules:**

- Append one entry per **successful** release only; failed attempts do not advance history.
- **`registrySnapshot`** = prod `.storage/core.entity_registry` **after** migrations + git deploy for that release completed (post-restart consistent state). Taken on every release that stopped Core or ran any `registry.*` step; for YAML-only releases, copy optional but recommended for cheap full restore.
- Snapshots live under `/sidecar-data/release-snapshots/<shortSha>/` — retain **all** releases in history (prune policy: keep last N or age — default **keep all**, disk is small).
- Compat: `last-prod-deploy.sha` = `releases[current].sha`; `last-prod-deploy-previous.sha` = previous entry’s sha (kit Overview rollback unchanged).

### Git audit trail (reviewable in repo)

After each successful apply, config-repo gets (agent commit or automated PR):

```
migrations/applied/<id>.yaml          ← moved from pending/
releases/records/<shortSha>.yaml      ← human-readable release record
```

Example `releases/records/505ff53.yaml`:

```yaml
apiVersion: ha-staging-kit/v1
kind: ReleaseRecord
metadata:
  sha: 505ff53deadbeef…
  appliedAt: 2026-06-20T10:00:00Z
spec:
  migrationsApplied:
    - squigglebear-tv-suffix-collision
  storageBundlePaths:
    - .storage/lovelace.lovelace
  yamlDeployed: true
  agentReport: release-reports/505ff53.json
```

Git history + these records answer “what shipped when?” Rollback **execution** uses runtime ledger + snapshots (git alone is insufficient after registry migrations).

### Migration id ledger sync

`migrations-applied.json` (idempotency) must stay consistent with release history:

- On **apply:** append migration ids run in this release.
- On **rollback** to index *N:* remove ledger entries for migrations applied in releases with `index > N` (registry was restored to post-release-*N* state; those forward migrations are undone).

Re-applying a rolled-back release re-runs migrations because ids were removed from the ledger.

---

## Rollback (multi-release)

Rollback is a **first-class** agent operation — not a one-step “undo last deploy” only.

### Commands

| Command | Behaviour |
|---------|-----------|
| `release-agent history` | List releases (index, sha, date, migrations, yaml/storage flags) |
| `release-agent rollback --steps 1` | Restore previous release (kit “Rollback prod” equivalent) |
| `release-agent rollback --steps 3` | Go back three releases |
| `release-agent rollback --to-sha 505ff53` | Restore exact release matching sha (or fail if ambiguous) |
| `release-agent rollback --to-index 5` | Restore release history index 5 |

All variants run the same restore pipeline.

### Restore pipeline

```
1. Resolve target release entry T from history (must exist; refuse if no snapshots for registry-heavy releases)
2. Acquire release.lock
3. Stop prod Core
4. Restore registry snapshots from T.registrySnapshot (+ device registry if present)
5. Deploy git config @ T.sha:
   - YAML sparse checkout / rsync (same as kit SshGitDeployRefAsync)
   - Lovelace/helper .storage paths listed in T.storageBundlePaths @ T.sha
6. Sync migrations-applied.json — drop ids from releases after T.index
7. Set currentIndex = T.index; rewrite last-prod-deploy*.sha compat files
8. Start prod Core
9. Write rollback-report.json; optional git commit on main documenting rollback (releases/records/<sha>-rollback.yaml) — does not rewrite old commits
```

**Result:** prod matches **exactly** what it was after release *T* — YAML, bundled `.storage`, and registry.

### What git rollback alone cannot do

Reverting `main` with `git revert` does **not** restore prod registry. Always use **release-agent rollback** (or manual snapshot restore + deploy @ sha). The config-repo stays the forward source of truth; rollback is a **prod runtime** operation.

### Failed / partial releases

| Situation | Action |
|-----------|--------|
| Migrations ran, git deploy failed | Do not append history. Operator: `rollback --steps 0` restores pre-attempt snapshot if taken, or restore last good release |
| Registry backup missing for target | Refuse rollback to that release; list available snapshots |
| Roll back across migration-only release | Restore snapshot + git @ sha; migration ledger trimmed |

Pre-attempt snapshot: before step 5 of apply (stop Core), copy registry to `/sidecar-data/release-snapshots/_attempt-<timestamp>/` and delete on success after post-release snapshot is stored.

### Retention

Default: keep full release history and all snapshots until operator prunes (`release-agent prune --keep 20`). Prune refuses if it would remove a release still referenced as rollback target.

---

| Check | On fail |
|-------|---------|
| JSON Schema validation | Fail before touching prod |
| Entity deploy scan (blocking refs) | Fail; same messages as kit gate |
| Manifest preconditions | Fail release (default); optional skip-with-log for soft migrations (not MVP) |
| Prod writes lock | Agent ignores kit UI lock — operator credentials. Kit Request release only enabled when user intentionally runs release |
| Working tree / SSH | Fail with actionable error |

**Concurrency:** file lock on prod (`/sidecar-data/release.lock`) — second agent exits if lock held.

**Dry run:** `release-agent plan --ref origin/main` — validate + print manifest order, no SSH writes.

---

## Preflight & safety

## Observability

| Output | Purpose |
|--------|---------|
| Structured stdout/stderr | CLI + CI logs |
| Exit codes | 0 ok, 1 preflight, 2 apply failure, 3 partial (registry done, git failed) |
| `release-report.json` | SHA, manifests applied/skipped, deploy paths, duration |
| Kit Activity / op log | Kit Request release forwards agent log tail (integration #15) |

---

## Packaging (#14)

| Option | Fit |
|--------|-----|
| **CLI in ha-staging-kit repo** | MVP — run on Unraid host or in kit container |
| **systemd unit** | `release-agent apply` on timer disabled; manual enable |
| **GitHub Actions** | Self-hosted runner with SSH key to prod; job on `push: main` with manual approval gate |
| **Windows service** | Same binary as CLI — later |
| **Inside kit container** | Convenient for Request release — `dotnet` tool or script in `/app` |

MVP recommendation: **CLI + optional kit subprocess**, share `KitPaths` / env with console. CI integration second.

---

## Kit UI convergence (#15)

| Today | Target |
|-------|--------|
| Ship wizard → **Deploy to prod** (SSH, prod writes lock) | **Request release** → agent dry-run → confirm → apply |
| Fix entity id on prod | Export migration only (done #11) |
| Rollback prod | `release-agent rollback --steps 1` (or `--to-sha` / `--to-index`); kit button wraps same API |

Agent success clears deploy-gate blockers that depended on registry migrations (#12 E2E).

---

## MVP acceptance (#14)

- [ ] CLI `plan` and `apply` against prod from git `main` @ known SHA
- [ ] Runs pending manifests with ledger idempotency
- [ ] Applies YAML + Lovelace bundle deploy equivalent to kit `DeployToProdInternalAsync`
- [ ] **Release history:** append full record + post-release registry snapshot every successful apply
- [ ] **Multi-rollback:** `history`, `rollback --steps N`, `rollback --to-sha`, `rollback --to-index`
- [ ] Migration ledger trimmed on rollback; compat `last-prod-deploy*.sha` updated
- [ ] Git audit: `migrations/applied/` + `releases/records/<sha>.yaml` committed after apply
- [ ] Validates manifests with existing JSON Schema + `validate-migration-manifest.mjs` in CI
- [ ] Documented operator runbook in `release-agent/README.md`

**E2E (#12):** after MVP, export three pilots → merge `main` → agent apply → entity deploy scan green.

---

## Open decisions (resolve in #14)

1. **Language:** extract shared C# library from console vs bash orchestrating SSH (parity with sidecar).
2. **Git commit after apply:** agent commits `migrations/applied/` + `releases/records/` directly on `main`, or opens PR / kit follow-up commit.
3. **Pending cleanup:** move to `migrations/applied/` in same commit as release record (never delete from git).
4. **Snapshot scope:** entity registry only MVP, or entity + device registry whenever migrations run.
5. **GitHub Actions vs manual-only** for first prod use.

---

## Related files (today)

| Area | Path |
|------|------|
| Kit deploy | `console/HaStagingConsole/Services/OperationsService.cs` |
| Registry fix | `ProdEntitySuffixFixService.cs`, `ProdDeletedRegistryPurgeService.cs` |
| Lovelace bundle | `ProdStorageDeployService.cs` |
| Deploy tracker | `KitPaths.LastProdDeployShaFile` |
| Legacy CI rsync | `config-repo/scripts/deploy/ha-prod-deploy.sh` |
| Manifest spec | [design-migration-manifest.md](design-migration-manifest.md) |

---

## Related issues

| Issue | Role |
|-------|------|
| [#9](https://github.com/Unthred/ha-staging-kit/issues/9) | Epic |
| [#10](https://github.com/Unthred/ha-staging-kit/issues/10) | Manifest format — done |
| [#11](https://github.com/Unthred/ha-staging-kit/issues/11) | Kit export — done |
| [#12](https://github.com/Unthred/ha-staging-kit/issues/12) | Pilots — after #14 |
| [#14](https://github.com/Unthred/ha-staging-kit/issues/14) | Build MVP |
| [#15](https://github.com/Unthred/ha-staging-kit/issues/15) | UI convergence |
