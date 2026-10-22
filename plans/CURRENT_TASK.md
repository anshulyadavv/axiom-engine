# Axiom Engine — Current Task

> **Status Source of Truth**: [README Capability Status](../README.md#capability-status)

---

## Current Objective

Complete empirical verification and documentation hardening (Tasks 1 through 7) without premature benchmark JSON regeneration, pending user commit for final clean provenance (Task 8).

## Active State & Deliverables

1. **Task 1 (FAILURE_MODEL A4 Overclaim)**:
   - Unticked A4 in `docs/FAILURE_MODEL.md` (Option B chosen).
   - Cited storage integration tests (`test_fenced_write_fails_with_stale_token`, `test_renew_lease_fails_after_reacquisition_by_another_worker`) in `crates/axiom-storage/tests/integration_tests.rs`.

2. **Task 2 (Results JSON Provenance)**:
   - Updated `Get-BenchmarkMetadata` in `scripts/benchmark.ps1` to record `git_commit` (HEAD), `git_dirty` (boolean via `git status --porcelain`), and `git_diff_hash` (SHA256 of `git diff HEAD`, or null if clean).
   - Documented PostgreSQL measured version in `docs/RESEARCH.md`: local benchmarks measured against PostgreSQL 15.19 (`docker-postgres-1`), while CI runs against PostgreSQL 16.

3. **Task 3 (End-to-End Throughput: Repeat and Relabel)**:
   - Added multi-trial repetitions (`-Trials 5`) and `-SleepAlways` toggle to `scripts/benchmark.ps1`.
   - Measured 5 trials each (5 runs/trial, 1 worker, 2000 ms poll):
     - Before (`AXIOM_SCHEDULER_SLEEP_ALWAYS=1`): Wall-clock Min 48.079 s | Median 50.142 s | Max 51.153 s. Completed throughput: 0.10 runs/s across all trials. Latency Min 11,801.62 ms | Median 42,964.42 ms | Max 51,012.05 ms.
     - After (Default repoll): Wall-clock Min 11.172 s | Median 13.323 s | Max 14.914 s. Completed throughput: Min 0.34 | Median 0.38 | Max 0.45 runs/s. Latency Min 6,495.51 ms | Median 9,907.49 ms | Max 14,852.89 ms.
     - Median wall-clock ratio: 3.76x faster (-73.4% median time). Median throughput: 3.80x higher. Median latency: 4.34x faster (-76.9%).
   - Relabeled "Run Latency" to "time from submission to Completed (includes queue wait; all runs submitted at once)".

4. **Task 4 (API-Only Throughput & Rate Limiter)**:
   - Measured API-only throughput (1000 requests, concurrency 20, 3 trials each):
     - With `AXIOM_RATE_LIMIT_DISABLED=1`: Min 80.26 | Median 100.02 | Max 103.23 req/s (0 errors across all trials).
     - With default limiter: Min 15.28 | Median 34.60 | Max 70.16 req/s (Errors: Min 0 on fresh trial, Median 616, Max 808 on sustained trials).
   - Documented in `README.md` and `docs/RESEARCH.md` that the default limiter (1000/min per tenant token bucket) throttles sustained load above ~16.7 req/s.

5. **Task 5 (Outbox Lag: Steady State vs Burst)**:
   - Inspected `crates/axiom-worker/src/relayer.rs`: batch size = 50, idle sleep = 500 ms -> maximum theoretical drain rate = 100 messages/s.
   - Added `-CollectMode steady` (~50 msgs/s, ~50% drain rate) and `burst` (~200 msgs/s). Collected 1,000 samples for each:
     - Steady State (50 msgs/s): Min 48 ms | Median 383 ms | Avg 367.69 ms | p95 601 ms | p99 682 ms | Max 753 ms.
     - Burst (~200 msgs/s): Min 28 ms | Median 3,200 ms | Avg 3,141.15 ms | p95 6,190 ms | p99 6,382 ms | Max 6,411 ms.
   - Verified that synthetic benchmark messages on `axiom.benchmarks.*` are dropped by the worker without sidecar execution or database mutations.

6. **Task 6 (Recovery Breakdown: Measured vs Estimated)**:
   - Instrumented 4 timestamps in `scripts/benchmark.ps1`: (i) kill time, (ii) lease expiry from DB, (iii) Worker 2 claim time from worker log/DB, (iv) first replayed event from sidecar stderr (`packages/sdk/src/engine.ts`).
   - Ran 10 trials with `AXIOM_LEASE_TTL_MS=5000`:
     - Remaining Lease TTL (`lease_expires_at - kill_time`): Min 2,253.59 ms | Median 2,762.59 ms | Max 4,619.14 ms.
     - Scheduler Poll Jitter (`claim_time - lease_expires_at`): Min 54.36 ms | Median 1,492.48 ms | Max 1,681.89 ms.
     - Sidecar Spawn & First Replay (`first_replayed_event - claim_time`): Min 240.56 ms | Median 289.61 ms | Max 572.18 ms.
     - Total Recovery Latency (`claim_time - kill_time`): Min 2,307.95 ms | Median 4,293.25 ms | Max 6,301.03 ms.
   - Re-execution invariant passed in all 10 trials (0 duplicate step 1 executions, 0 DeterminismViolations).
   - Documented that at production default lease (30 s), recovery latency is approximately remaining lease TTL plus poll jitter (~15–30 s).

7. **Task 7 (Archive and Test Counts)**:
   - Removed `docs/archive/` from tracked files and verified `.gitignore` entry.
   - Checked that zero links point to `docs/archive/` or `plans/PHASE_4A_AUDIT.md`.
   - Verified all 46 `Implemented` citations in `plans/MASTER_PLAN.md` exist on disk via `scripts/verify_citations.js` (0 missing).
   - Ran complete test suites:
     - `cargo test --workspace -- --test-threads=1`: 47 passed, 0 failed across 15 test binaries.
     - `npm test` in `packages/sdk`: 23 passed, 0 failed across 3 test suites.
     - Grand total: 70 tests passed, 0 failed.

8. **Task 8 (Final Regeneration)**:
   - Working tree is ready. Awaiting user commit before regenerating `benchmarks/results/*.json` to ensure `git_dirty: false`.

## Known Issues & Notes

- JSON files in `benchmarks/results/` have intentionally NOT been regenerated yet; they retain earlier commit timestamps until the user commits the working tree.
- Local PostgreSQL version is 15.19; CI runs on PostgreSQL 16.

## Next Steps

1. Await user commit of Tasks 1–7.
2. Run benchmark regeneration suite with `-SaveResults` so all JSON files record `git_dirty: false` and null `git_diff_hash`.
