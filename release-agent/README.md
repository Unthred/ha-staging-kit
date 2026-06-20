# Release agent

Applies approved git releases to **prod**: migration manifests + YAML / Lovelace bundle deploy, with **multi-release rollback**.

Design: [docs/design-release-agent.md](../docs/design-release-agent.md) · Issue [#14](https://github.com/Unthred/ha-staging-kit/issues/14)

## Commands (kit API)

Run from the kit host or via the wrapper script.

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/release-agent/plan?gitRef=origin/main` | Dry-run plan |
| POST | `/api/release-agent/apply` | Apply release |
| GET | `/api/release-agent/history` | List releases |
| POST | `/api/release-agent/rollback` | Roll back N releases or to SHA/index |

### Apply

```bash
curl -sS -X POST http://127.0.0.1:8081/api/release-agent/apply \
  -H 'Content-Type: application/json' \
  -d '{"gitRef":"origin/main","message":"Ship staging work"}'
```

### Rollback

```bash
# Previous release
curl -sS -X POST http://127.0.0.1:8081/api/release-agent/rollback \
  -H 'Content-Type: application/json' \
  -d '{"steps":1}'

# Three releases back
curl -sS -X POST http://127.0.0.1:8081/api/release-agent/rollback \
  -H 'Content-Type: application/json' \
  -d '{"steps":3}'

# Exact SHA
curl -sS -X POST http://127.0.0.1:8081/api/release-agent/rollback \
  -H 'Content-Type: application/json' \
  -d '{"toSha":"505ff53"}'
```

## Wrapper CLI

```bash
bash scripts/release-agent.sh plan
bash scripts/release-agent.sh apply
bash scripts/release-agent.sh history
bash scripts/release-agent.sh rollback --steps 1
```

## State files (sidecar-data)

| File | Purpose |
|------|---------|
| `release-history.json` | Ordered releases + rollback targets |
| `migrations-applied.json` | Migration idempotency ledger |
| `release-snapshots/<sha>/` | Post-release registry backups |
| `release-reports/<sha>.json` | Apply report |
| `last-prod-deploy.sha` | Compat alias for kit Overview |

## Deploy

Ship with the kit API:

```bash
bash ha-staging-kit-deploy-quick.sh api
```
