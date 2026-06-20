# Resume ha-staging-kit

When the user says **resume staging-kit** (or similar), read this first, then the full checkpoint.

## One-line

**Baseline reset done (2026-06-20):** `staging` = `main` @ `505ff53`, storage sync OK, sidecar WIP cleared. **#10 + #11 shipped:** migration manifest + kit export migration. **#15 phase 1:** prod-writes lock. **#13 done:** [design-release-agent.md](docs/design-release-agent.md). **Next:** #14 MVP, then #12 pilots.

## Read next

1. **[docs/design-release-agent.md](docs/design-release-agent.md)** — release pipeline spec (#13 done)
2. **[docs/plan-staging-prod-baseline.md](docs/plan-staging-prod-baseline.md)** — baseline phases + database roadmap  
2. **[docs/checkpoint-2026-06-20-staging-baseline-and-architecture.md](docs/checkpoint-2026-06-20-staging-baseline-and-architecture.md)** — naming scan, north star  
3. **[docs/architecture.md](docs/architecture.md)** — principles  

## Board

Epic [#9](https://github.com/Unthred/ha-staging-kit/issues/9) + children #10–#19 on [ha-staging-kit](https://github.com/users/Unthred/projects/4). Roadmap: [design-release-architecture-roadmap.md](docs/design-release-architecture-roadmap.md).

## Next default

1. **#14** — MVP API deployed (plan/apply/history/rollback); finish git audit commits + Request release UI (#15) + E2E (#12)
2. **#20** — Phase 2 state mirror (non-MQTT entities)
3. **#12** — pilot migrations once release path validated on prod
