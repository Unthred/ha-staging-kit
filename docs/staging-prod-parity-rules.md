# Staging ↔ prod parity — rules and exceptions

Goal: keep staging and prod **as identical as practical** for YAML, registries, Lovelace, and integration config — while **never silently breaking** kit control paths (API tokens, MQTT mirror, LAN safety).

Use this when changing sync scripts, deploy paths, or onboarding copy.

---

## Principles

1. **Git YAML is shared** — `staging` branch on staging HA, `main` on prod HA (via kit deploy).
2. **Prod `.storage` is the live baseline** for registries, Lovelace on disk, helpers, MQTT integration entries — copied to staging by **storage sync**.
3. **Staging-only runtime** — `sidecar_generated.yaml`, kit API tokens, staging LLATs, LAN integration disable list.
4. **Prod deploy never writes** `auth`, full `core.config_entries` from staging, or `secrets.yaml` from git.

---

## Matrix: what crosses the boundary

| Artifact | Direction | Sync? | Risk if wrong | Mitigation |
|----------|-----------|-------|---------------|------------|
| Git YAML/packages | git → staging; git → prod | **Yes** | Wrong automations on wrong host | Branch discipline; entity deploy scan before prod |
| `secrets.yaml` | prod SSH → staging (apply-config) | **Yes** | Staging holds prod-equivalent secrets | Never commit; restrict staging network |
| `secrets.yaml` | git → prod | **No** | Would overwrite live secrets | apply-config excludes; prod uses disk secrets |
| `.storage` registries (entity/device/person) | prod → staging | **Yes** | Stale entity IDs on staging | Storage sync |
| `.storage` Lovelace + UI helpers | prod → staging; staging → git snapshot; git → prod bundle | **Yes** (scoped) | Broken cards on prod | Entity deploy scan; Lovelace bundle only on prod deploy |
| `core.config_entries` | prod → staging | **Yes** | OAuth/MQTT creds point at prod | **patch-staging-storage.sh** rewrites MQTT broker; **preserve-staging-oauth-entries.sh** restores staging OAuth for allowlisted domains |
| **`auth`, `auth_provider.*`, `http.auth`** | prod → staging | **No** | Invalidates staging LLATs (kit, person poll, diagnostics) | **Excluded** from storage sync — see below |
| `core.config` (instance_id) | prod → staging | **Yes** | HA Cloud / duplicate instance if both enrolled | Local staging OK; do not cloud-link both |
| `restore_state`, `bluetooth`, `counter` | prod → staging | **No** | Device state clash | Already excluded |
| `mobile_app` creds | prod → staging | **No** | Phones would report to wrong instance | Never sync; person **poller** mirrors state |
| Person/tracker **state** | prod REST → staging REST | **Yes** (poller) | Stale presence on staging | Kit tokens; not credential copy |
| Kit LLAT files | operator → kit secrets | **Staging-only** | 401 on all staging API ops | Regenerate in Settings after token incidents |
| MQTT bridge | prod ↔ kit mirror | **Yes** | Live device state | Read-only default; control mode time-boxed |
| LAN integrations (ESPHome, cast, …) | disable on staging | **N/A** | Staging actuates real hardware | `disable-lan-integrations.sh` after apply |

---

## Exceptions (intentionally not identical)

### 1. Auth and API tokens — **do not sync**

**Rule:** Storage sync must **not** copy `auth`, `auth_provider.homeassistant`, or `http.auth` from prod.

**Why:** Long-lived access tokens (kit staging token, person poll write token) are tied to staging’s auth store. Overwriting with prod’s auth invalidates every staging-issued token → **401** on diagnostics, person poll, and Operations — while looking like “no integration issues”.

**Trade-off:** Staging HA **UI login** stays staging-local (users/passwords are not cloned from prod). Everything else (registry, Lovelace, integration entries) still matches prod.

**After workbench reset or first kit setup:** create a staging LLAT → **Settings → Staging** in the kit.

### 2. MQTT broker hostname — **sync then patch**

**Rule:** Copy prod `core.config_entries` (includes MQTT username/password), then **always** run `patch-staging-storage.sh` to set broker to `STAGING_MQTT_BROKER` (kit mirror IP).

**Why:** Prod entries reference `core-mosquitto` (prod broker). Staging must hit the kit mirror, not prod directly.

**Never** set `SKIP_MQTT_PATCH=1` in normal ops when mirror is enabled.

### 3. LAN / hardware integrations — **disabled on staging**

**Rule:** After apply-config, run `disable-lan-integrations.sh` (ESPHome, Cast, Broadlink, Android TV, etc.).

**Why:** Staging must not discover or actuate devices on the LAN.

### 4. Presence — **state mirror, not credential mirror**

**Rule:** Person poll copies `person.*` / `device_tracker.*` **states** from prod; do not sync `mobile_app` auth.

See [person-presence-sync.md](person-presence-sync.md).

### 5. Prod deploy — **Lovelace/helpers only in `.storage`**

**Rule:** Prod deploy pushes YAML from git `main` + a fixed allowlist of `.storage` files (Lovelace quartet, timers, input helpers, etc.). Never push staging `auth` or full config entries to prod.

See [design-entity-deploy-scan.md](design-entity-deploy-scan.md).

### 6. MQTT mirror control mode — **opt-in only**

**Rule:** Default read-only. Control mode forwards `zigbee2mqtt/+/set` to prod — real devices move. Disable after tests.

### 7. Cloud / OAuth integrations — **preserve staging tokens after storage sync**

**Rule:** Prod and staging **can both** be linked to the same cloud service (SmartThings, Tuya, etc.) — each Home Assistant instance needs **its own** OAuth tokens. Storage sync copies prod’s `core.config_entries`, then **restores staging OAuth entries** for domains in `OAUTH_PRESERVE_DOMAINS` (default: `smartthings tuya`) — same pattern as the MQTT broker patch.

**Flow:** `preserve-staging-oauth-entries.sh backup` (staging state) → rsync prod `.storage` → MQTT patch → `preserve-staging-oauth-entries.sh restore` (merge by `entry_id`).

**When you still need to re-auth on staging:**

- **First time** for a cloud integration (staging never had valid tokens — backup holds prod copy until you Reconfigure once).
- **New** cloud integration added on prod only (no staging backup for that `entry_id`).
- Domain **not** in `OAUTH_PRESERVE_DOMAINS` — add it to sidecar `config.env` if needed.
- `SKIP_OAUTH_PRESERVE=1` — disables preserve (old behaviour).

**What does *not* wipe OAuth (when preserve enabled):**

| Action | Staging re-auth lost? |
|--------|------------------------|
| **Storage sync** (after at least one successful staging re-auth) | **No** — for allowlisted domains |
| **Apply staging config** (includes storage sync) | **No** — same |
| **Restart staging HA** | No |
| **Person poll / MQTT mirror / kit restart** | No |

**After storage sync checklist (staging HA UI):**

1. **Kit LLAT** — Settings → Staging in the kit (auth file excluded from sync; verify if diagnostics show `_kit`).
2. **SmartThings / Tuya** — Reconfigure **once** if still failing; later syncs should keep staging tokens.
3. **Other cloud domains** — Add to `OAUTH_PRESERVE_DOMAINS` or re-auth after each sync.
4. **MQTT** — Automatic broker patch; restart staging HA if entities stay unavailable.

**Why both prod and staging can stay linked:** Samsung/your cloud account allows multiple authorizations. Prod keeps its tokens; staging needs a **fresh** authorize once, then preserve keeps it across syncs.

---

## After each operation — checklist

| Operation | Expect | Verify |
|-----------|--------|--------|
| **Storage sync** | Registries/helpers from prod; auth **unchanged**; MQTT broker patched; **OAuth preserved** for allowlisted domains | Test staging token; re-auth cloud integrations **only if still failing** |
| **Apply staging config** | Git YAML + prod secrets; **includes storage sync by default** | Same as storage sync row |
| **Restart staging HA** | Reloads config; **does not** invalidate LLATs if auth not overwritten | Kit API still 200 on `/api/` |
| **Ship to staging** | Push + apply + restart | Same as apply + restart |
| **Workbench reset** | Hard reset git + full apply + storage sync | **Regenerate staging LLAT**; redeploy mirror; Recheck entity scan |
| **Deploy to prod** | YAML + Lovelace bundle on prod | Entity deploy scan PASS; restart Z2M if config changed |
| **Deploy / refresh mirror** | Mosquitto bridge from staging MQTT creds | Bridge connected on Environment |

---

## Kit surfacing

| Symptom | Meaning |
|---------|---------|
| Diagnostics → Staging: `_kit` “API token rejected” | Staging LLAT invalid — refresh in Settings (common if auth was synced before exclusion fix) |
| Person poll WARN staging push failed | Same — staging write token |
| Storage sync OK but token probe fails | Regenerate staging token (legacy auth overwrite or wrong token file) |
| MQTT entities unavailable on staging | Run storage sync + confirm broker patch log line |
| SmartThings / Tuya “failed to initialize” after sync | Re-auth **once** on staging; later syncs preserve tokens if domain is in `OAUTH_PRESERVE_DOMAINS` |
| No staging integration issues but prod has many | Usually token 401, not “healthy staging” |

---

## Changing this document

When adding a new file to `STORAGE_INCLUDES`, prod deploy paths, or sidecar scripts, update this matrix and note **Sync / Patch / Exclude / Manual**.

Related: [architecture.md](architecture.md), [staging-ha-mqtt.md](staging-ha-mqtt.md), [person-presence-sync.md](person-presence-sync.md).
