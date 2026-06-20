# Staging state mirror — Phase 2 (kit-owned)

**Status:** Design · **Issue:** [#20](https://github.com/Unthred/ha-staging-kit/issues/20)  
**Depends on:** Phase 1 MQTT mirror ([config-repo design](https://github.com/Unthred/HomeAssistant/blob/main/docs/design-staging-state-mirror.md)), storage sync, person poller  
**Replaces:** rejected `remote_homeassistant` approach (see § Rejected alternative)

---

## Goal

Mirror **live prod entity states** into staging for **non-MQTT** integrations (ESPHome, Z-Wave, cloud poll entities, etc.) so dashboards and automations see realistic data — **without**:

- creating duplicate entities on staging,
- giving staging prod service-call capability,
- staging talking to physical devices directly.

We **own** this component (sidecar + kit UI), so filters, safety, and ops match the MQTT mirror and parity rules — not third-party limits.

---

## What Phase 1 already covers

| Mechanism | Entities |
|-----------|----------|
| **Phase 1 MQTT mirror** | `mqtt` platform — Zigbee2MQTT, Tasmota, etc. |
| **Person poller** | `person.*`, linked phone `device_tracker.*` |

Phase 2 fills the **remaining device-backed gap** after storage sync.

---

## Architecture

```
Prod HA                              Staging HA
  │  WebSocket /api/websocket          │
  │  subscribe: state_changed           │  POST /api/states/{entity_id}
  │  (read-only LLAT)                   │  (write LLAT — existing ids only)
  └──────── state-mirror (sidecar) ─────┘
            │
            ├─ allowlist: domains / areas / entity_ids
            ├─ skip: mqtt.* (Phase 1), person.* (poller)
            └─ never: call_service on prod
```

### Core rules

1. **Update only** — never create entities; `entity_id` must exist in staging registry (post storage sync).
2. **State + attributes** — copy prod `state`, `attributes` (with optional attribute denylist for huge blobs).
3. **Read-only prod** — prod token used for WebSocket subscribe + optional bootstrap `GET /api/states`; **no** `POST /api/services/*` on prod.
4. **Write staging only** — same model as [person-presence-sync.md](person-presence-sync.md).
5. **Default off** — enable in Settings → State mirror; show stale count when disabled.

### Transport

| Mode | Use |
|------|-----|
| **WebSocket** (preferred) | Subscribe to `state_changed`; low latency, low load |
| **REST poll** (fallback) | `GET /api/states` on interval if WebSocket unavailable |

Bootstrap: on connect, full state snapshot for allowlisted entities, then incremental events.

---

## Allowlist strategy

Config in sidecar `config.env` + kit Settings UI:

```yaml
# conceptual
enabled: true
exclude_domains:
  - mqtt          # Phase 1
  - person        # person poller
  - device_tracker  # optional: poller owns phones
include_domains:   # if set, only these (minus excludes)
  - sensor
  - binary_sensor
  - light
  - switch
  - cover
  - climate
  - fan
  - lock
exclude_entities: []
include_entities: []   # optional explicit override
max_updates_per_second: 20  # coalesce burst
```

**LAN-disabled integrations** on staging (ESPHome, Cast, …) still benefit: their entities exist in registry from sync but integrations are disabled — **injected state** keeps cards and automations working without staging opening LAN sockets.

---

## Safety

| Risk | Mitigation |
|------|------------|
| Staging automation calls service on mirrored light | Staging integration disabled / no hardware — service may no-op or error locally; **does not** hit prod (unlike control mode) |
| Prod token misuse | Token scoped to read; sidecar code never calls prod services |
| State flood | Rate limit + coalesce per entity |
| Wrong entity updated | Verify entity_id in staging registry before POST |
| Deploy / restart race | Pause mirror during staging restart; optional pause during prod release agent apply |

**Actuation:** Phase 2 is **read-only state only**. Deliberate real-device control stays **MQTT control mode** (Phase 1b) for Z2M. Non-MQTT actuation from staging remains out of scope unless a future Phase 2b adds an explicit, audited path.

---

## Still out of scope (all phases)

- Camera streams, Cast media, voice assistants — need direct media/LAN paths
- Mirroring prod **recorder history**
- OAuth / cloud session sharing between instances
- `remote_homeassistant` or other unowned integrations

---

## Components (#20 implementation)

| Piece | Location |
|-------|----------|
| `state-mirror.sh` or sidecar daemon | `ha-staging-kit/sidecar/sbin/` |
| Registry allowlist builder | Read staging entity registry via API or `.storage` export |
| Kit Settings panel | Enable, domains, status, last error |
| Operations hint | Link from Environment / parity docs |
| Parity matrix row | [staging-prod-parity-rules.md](staging-prod-parity-rules.md) |

Person poller may later **merge into** state mirror (single daemon, special-case person domains) — not required for MVP.

---

## MVP acceptance

- [ ] WebSocket connect to prod; mirror allowlisted state changes to staging
- [ ] ESPHome / Z-Wave sensor on prod shows live value on staging dashboard (integration disabled on staging)
- [ ] No new entities created on staging; no prod service calls
- [ ] MQTT entities unchanged (still Phase 1); person entities still poller (or documented handoff)
- [ ] Kit toggle + health in Settings / Environment
- [ ] Documented in parity rules + Operations copy

---

## Rejected alternative — remote_homeassistant

[HACS remote_homeassistant](https://github.com/custom-components/remote_homeassistant) was **Phase 2 candidate (2026-06-10)** and **rejected** because we cannot control upstream behaviour:

- Creates **new** entities → registry collision with storage sync
- Prod token is **all-or-nothing** — domain filter is not a security boundary
- Fragile re-sync after every storage sync

**Phase 2** in this doc is the **kit-owned replacement**, not a revival of that integration.

---

## Related

- [staging-ha-mqtt.md](staging-ha-mqtt.md) — Phase 1
- [person-presence-sync.md](person-presence-sync.md)
- [staging-prod-parity-rules.md](staging-prod-parity-rules.md)
- [config-repo design-staging-state-mirror.md](https://github.com/Unthred/HomeAssistant/blob/main/docs/design-staging-state-mirror.md) — Phase 1 / 1b master doc
