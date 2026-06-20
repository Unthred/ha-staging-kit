# Migration manifest format

**Status:** Spec for [ha-staging-kit #10](https://github.com/Unthred/ha-staging-kit/issues/10)  
**Schema:** [config-repo/migrations/schema/migration-manifest.schema.json](../../config-repo/migrations/schema/migration-manifest.schema.json)  
**Examples:** [config-repo/migrations/examples/](../../config-repo/migrations/examples/)

---

## Purpose

A migration manifest is a **versioned, reviewable artifact in git** that tells the **release agent** what to change on **prod** beyond a plain config checkout:

| Change type | Git commit alone | Needs manifest step |
|-------------|------------------|---------------------|
| Fix Lovelace entity string in `.storage/lovelace.lovelace` | Yes (bundle deploy) | Optional `config.replace_entity_id` if agent applies from tree |
| Fix `scripts.yaml` entity refs | Yes | Same |
| Rename prod entity registry id (`_2` → base, `_3` → `_cast`) | **No** | `registry.*` steps |
| Remove registry tombstone blocking an id | **No** | `registry.purge_deleted_tombstones` |

The kit **exports** manifests (#11). The release agent **executes** them (#14). Kit SSH “fix prod” buttons map 1:1 to manifest actions (then get deprecated #15).

---

## File format

- **Encoding:** UTF-8 YAML (JSON equivalent allowed for tooling).
- **Location:** `migrations/pending/<id>.yaml` when queued; `migrations/examples/` for docs only.
- **Idempotency:** `metadata.id` is the ledger key — release agent skips if already applied at this prod instance.

```yaml
apiVersion: ha-staging-kit/v1
kind: Migration
metadata:
  id: zaphod-shield-cast-lovelace
  title: Fix Lovelace zaphod_shield_3 reference
  description: Dashboard typo; prod entity is already zaphod_shield_cast.
  issue: https://github.com/Unthred/ha-staging-kit/issues/12
spec:
  stopHomeAssistant: false
  preconditions:
    - type: entity_exists
      entityId: media_player.zaphod_shield_cast
  steps:
    - name: Fix Lovelace card entity
      action: config.replace_entity_id
      params:
        fromEntityId: media_player.zaphod_shield_3
        toEntityId: media_player.zaphod_shield_cast
        paths:
          - .storage/lovelace.lovelace
```

---

## Apply order (release agent)

For each manifest in `migrations/pending/` (sorted by filename unless `metadata.id` order file added later):

1. **Validate** manifest against JSON Schema.
2. **Check preconditions** against prod (registry SSH read + optional file grep on release tree).
3. If `spec.stopHomeAssistant` **or any step** uses `registry.*`: **stop prod Core**, wait until API down.
4. Run **steps in array order**.
5. **Start prod Core** (if stopped).
6. Record `metadata.id` in apply ledger (`migrations/applied/` — format TBD in #14).
7. Continue with normal **git deploy** (YAML + Lovelace bundle from `main`) if not already done in same release.

**Rollback:** registry steps are undone by restoring the **release snapshot** for an earlier git SHA, not by reversing manifest steps in place. See [design-release-agent.md](design-release-agent.md) § Release history.

Registry edits **must** happen while Core is stopped — same rule as today’s `ProdEntitySuffixFixService`.

---

## Preconditions

| `type` | Pass when |
|--------|-----------|
| `entity_exists` | Active entity in prod `core.entity_registry` |
| `entity_not_exists` | No active entity with that id |
| `entity_disabled` | Entity exists and `disabled_by` is set |
| `file_contains_entity` | File at `path` (from release tree) contains `text` |

Failed precondition → manifest **skipped** (logged) or **fail release** (agent policy; default **fail** for safety).

---

## Step actions

### `registry.suffix_collision_fix`

Maps to kit `FixSuffixCollisionAsync`. Removes stale **blocker** occupying `expectedEntityId`, renames `suffixEntityId` → `expectedEntityId`, moves blocker to `deleted_entities`.

| Param | Required | Notes |
|-------|----------|-------|
| `expectedEntityId` | yes | Target id (e.g. `media_player.squigglebear_tv`) |
| `suffixEntityId` | yes | Live `_2` entity |
| `blockerEntityId` | no | Defaults to `expectedEntityId` |

Requires `stopHomeAssistant: true` (agent may enforce automatically).

### `registry.rename_entity`

Maps to kit `FixWrongEntityIdAsync`. Renames one active registry entry when target id is free.

| Param | Required | Notes |
|-------|----------|-------|
| `fromEntityId` | yes | Current prod id |
| `toEntityId` | yes | Desired id |
| `relaxedUniqueId` | no | Use for cast renames (`marvin_3` → `marvin_cast`) |

### `registry.purge_deleted_tombstones`

Maps to kit purge deleted entities. Removes matching rows from `deleted_entities` only.

| Param | Required |
|-------|----------|
| `expectedEntityId` | yes |
| `uniqueIdPrefix` | no |

### `config.replace_entity_id`

String replace of full entity ids in tracked config files on prod disk (from release git tree paths). Used for Lovelace, `scripts.yaml`, `automations.yaml`.

| Param | Required |
|-------|----------|
| `fromEntityId` | yes |
| `toEntityId` | yes |
| `paths` | yes (array) |

Does not require HA stop if only files on disk and Core is already stopped for prior registry steps, or agent runs before start.

---

## Mapping from kit SSH buttons (deprecation target)

| Kit UI today | Manifest action |
|--------------|-----------------|
| Fix entity id on prod (suffix) | `registry.suffix_collision_fix` |
| Fix entity id on prod (rename) | `registry.rename_entity` |
| Purge deleted tombstones | `registry.purge_deleted_tombstones` |
| Lovelace parity fix (rename in git) | Git commit + optional `config.replace_entity_id` on prod |

---

## Pilot examples (issue #12)

| Example file | Scenario |
|--------------|----------|
| `001-zaphod-shield-cast-lovelace.yaml` | Git/Lovelace typo only — prod registry already correct |
| `002-squigglebear-tv-suffix-collision.yaml` | Registry suffix fix + scripts/Lovelace renames |
| `003-marvin-cast-rename.yaml` | Cast `_3` → `_cast` with `relaxedUniqueId` |

---

## Validation

From ha-staging-kit repo:

```bash
cd scripts && npm install
node validate-migration-manifest.mjs ../config-repo/migrations/examples/001-zaphod-shield-cast-lovelace.yaml
```

Exit 0 = schema OK. Wire into CI later (#14).

## Kit export (#11)

From the staging kit UI (**Operations → Deploy gate** or **Naming** tab), **Export migration** writes:

- `migrations/pending/<metadata.id>.yaml` in the config repo
- Git patches for `config.replace_entity_id` steps (scripts, automations, Lovelace bundle paths)

API: `POST /api/operations/export-migration` with `{ source: "naming" | "deploy-gate", naming?, deployGate? }`.

Prod is **not** modified — registry steps run later via the release agent (#14).

---

## Related

- [architecture.md](architecture.md) — north star
- [design-release-agent.md](design-release-agent.md) — apply pipeline (#13 / #14)
- [design-release-architecture-roadmap.md](design-release-architecture-roadmap.md)
- [design-entity-deploy-scan.md](design-entity-deploy-scan.md) — current SSH fix behaviour
