# Tasks — 023 Gateway rate limiting

Implementation steps for [`spec.md`](./spec.md) / [`research.md`](./research.md), from
the approved plan at `.claude/loops/gateway-rate-limiting-impl/feature-plan.md`. One
conventional commit per step.

- [x] 1. `feat(db): add rate_buckets table and debit_bucket RPC`
- [x] 2. `feat(db): add active_requests table and claim_concurrency_slot RPC`
- [x] 3. `feat(server): add rateLimit config module`
- [x] 4. `test(server): add rateLimit unit tests`
- [x] 5. `test(server): extend gatewayRoute fake supabase client for rpc and active_requests`
- [x] 6. `feat(server): integrate rate limiting into gateway route`
- [ ] 7. `test(server): add gateway route rate-limit cases`
- [ ] 8. `test(server): add rate bucket integration tests`
