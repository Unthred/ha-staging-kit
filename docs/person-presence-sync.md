# Person and presence sync

**Why staging needs this:** phones and the Home Assistant Companion app report location to **prod only**. Staging does not (and should not) share prod `mobile_app` credentials. Without a mirror step, `person.*` and phone trackers on staging stay stale — location automations and dashboards look wrong even when YAML is identical.

The sidecar **person poller** copies prod `person.*` and linked `device_tracker.*` states to staging over the REST API. No webhook package in git; no prod write access.

## What is synced

| Entity type | Example | Source |
|-------------|---------|--------|
| `person.*` | `person.squiggley` | Prod REST `GET /api/states` |
| Linked trackers | `device_tracker.pixel_8` | Same poll — entities tied to persons in the entity registry |

**Not synced via the poller:**

- Raw GPS streams or Companion app sessions on staging
- Zones (`zone.*`) — define the same zones in YAML on both instances, or rely on person state strings (`home`, `not_home`, zone slugs)
- Non-phone trackers unless they appear as prod `person` / `device_tracker` states you care about

Person **pictures** come from a separate **storage sync** (`.storage/person` + `image/` uploads), not the poller loop.

## Architecture

```
Prod HA (phones → mobile_app)     Staging HA
        │                                ▲
        │ GET states (read token)        │ POST /api/states (write token)
        └──────── ha-staging-sidecar ────┘
                  person-poller.sh
```

Default interval: **60s** (`PERSON_POLL_INTERVAL` in sidecar `config.env`).

## Setup (manual until web onboarding ships)

### 1. Tokens

Create long-lived tokens in each HA instance (Settings → Security → Long-Lived Access Tokens).

| File | Line 1 | Line 2 |
|------|--------|--------|
| `$SIDECAR_DATA/secrets/ha-prod-api.token` | Prod URL, e.g. `https://home.yeradonkey.com` | Prod token (**read** — person/tracker states) |
| `$SIDECAR_DATA/secrets/ha-staging-api.token` | Staging URL | Staging token (**write** — update states) |

See `sidecar/secrets/*.token.example`. Mode **600** on all secret files.

### 2. Sidecar running

```bash
bash scripts/deploy.sh
docker exec ha-staging-sidecar /sidecar/sbin/person-poller.sh --once
```

The sidecar loop runs the poller every `PERSON_POLL_INTERVAL` seconds when the container is up.

### 3. Verify

On staging, open **Developer tools → States** and compare to prod:

- `person.*` states should match prod within one poll interval (~60s)
- Linked `device_tracker.*` entities should follow

One-shot check from the host:

```bash
docker exec ha-staging-sidecar /sidecar/sbin/person-poller.sh --once
docker logs ha-staging-sidecar 2>&1 | tail -5
```

Expected log line: `Synced N person/tracker states from prod`.

## Web console (planned)

First-run **onboarding** and day-two **Operations → Person poll now** will live in the kit web UI ([#1](https://github.com/Unthred/ha-staging-kit/issues/1), [#6](https://github.com/Unthred/ha-staging-kit/issues/6)). Settings for prod/staging URLs and tokens will be write-only fields with “configured ✓” — same model as [design-onboarding-wizard.md](design-onboarding-wizard.md).

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `WARN: missing prod/staging API token` | Secret files missing or wrong path | Check `$SIDECAR_DATA/secrets/` mounts; run `init-data-dirs.sh` |
| `no person/tracker entities in registry` | Staging entity registry empty | Run storage sync once, or define persons in staging YAML and restart HA |
| States never update | Wrong prod URL/token; network | Test prod URL from sidecar container; regenerate read token |
| Staging states revert | Staging HA or integration overwriting | Poller runs continuously — check for conflicting automations |
| Person photo missing | Images not synced | Run `sync-storage.sh` (includes `image/` and `.storage/person`) |
| `401` on staging API after storage sync | Legacy: prod `auth` was copied (fixed — auth no longer synced) | Regenerate staging LLAT in kit **Settings → Staging** once; future syncs preserve auth |

## Security notes

- Prod token should be **read-only** in practice (person poll uses GET only).
- Staging token needs permission to **set state** on person/tracker entities.
- Do **not** copy prod `mobile_app` or OAuth flows to staging for presence — that duplicates phone reporting and breaks the prod/staging split.

## Related

- [setup.md](setup.md) — full kit setup
- [architecture.md](architecture.md) — sidecar overview
- HomeAssistant [#21](https://github.com/Unthred/HomeAssistant/issues/21) — original INV-01 delivery (closed)
- `sidecar/sbin/person-poller.sh` — implementation
