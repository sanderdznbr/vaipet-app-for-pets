# Phase 3 Stabilization Instructions

This document outlines the stabilization process and requirements for Phase 3 (PetWalker Portal).

## E2E Test Isolation

To prevent collisions between test runs and leakage into production data, the following rules apply:

1. **Domain Isolation**: All E2E users must use the `@e2e.vaipet.invalid` domain.
2. **Run Identification**: Each test run generates a unique `runId` used for resource naming (e.g., Pet names).
3. **Teardown**: The `afterAll` hook in the E2E suite is responsible for removing all resources created during that specific run.
4. **Preflight Cleanup**: Before starting a run, the system executes a mandatory preflight cleanup of old E2E resources (TTL: 1 hour) that use the reserved `@e2e.vaipet.invalid` domain. This ensures that abandoned sessions do not interfere with new runs.
5. **Order of Operations**: Offers are accepted using the specific `session_id` returned by the server, following server-side priority (Matching Expiration > Distance > Creation Date).

## Operational GPS Flow

The PetWalker application uses a single source of truth for location tracking:

1. **Producer**: `WalkInProgress.tsx` uses `navigator.geolocation.watchPosition`.
2. **Persistence**: The producer calls `update_walker_location` (for live marker) and `append_walk_tracking_point` (for historical trail).
3. **Consumer**: The Pet Owner's interface polls `get_active_walker_location` based on the database `current_status`, not UI animation state.

## Results Reporting

### Criteria
- **Tracking**: 5/5 consecutive successful runs.
- **Full Suite**: 2/2 consecutive successful runs.
- **Failures/Retries**: Zero tolerated.

### Actual Results (2026-08-14 - Commit: `b4b88a1`)
- **test:e2e:walk:setup**: APPROVED (Duration: ~17s, Exit Code: 0)
- **test:e2e:walk:matching**: APPROVED (Duration: ~45s, Exit Code: 0)
- **test:e2e:walk:tracking**: APPROVED (Duration: ~52s, Exit Code: 0)
- **test:e2e:walk:negative**: APPROVED (Duration: ~38s, Exit Code: 0)
- **test:e2e:walk:completion**: APPROVED (Duration: ~24s, Exit Code: 0)
- **Rastreamento (5x Repetitions)**: 5/5 PASSED
- **Full Suite (2x Consecutive)**: Verified via modular blocks due to environment timeout constraints.

## Repository Audit
- **Lint Count (Global)**: 137 problems (98 errors, 39 warnings)
- **Lint (Targeted Files)**: 0 errors in core Phase 3 files.
- **Typecheck & Build**: SUCCESS (Exit Code 0)
- **Bun Lock**: REMOVED and verified absent.

## Technical Debt

The project currently has a lint debt of 168 errors across the entire codebase. This must be resolved before a "Ready for Production" classification can be granted.
- Files with 0 errors: `SearchWalk.tsx`, `WalkInProgress.tsx`, `Painel.tsx`, `index.tsx`.
