# Phase 3 Stabilization Instructions

This document outlines the stabilization process and requirements for Phase 3 (PetWalker Portal).

## E2E Test Isolation

To prevent collisions between test runs and leakage into production data, the following rules apply:

1. **Domain Isolation**: All E2E users must use the `@e2e.vaipet.invalid` domain.
2. **Metadata Marking**: All E2E users must have `user_metadata.e2e_test === true` and a unique `e2e_run_id`.
3. **Run Identification**: Each test run generates a unique `runId` used for resource naming (e.g., Pet names).
4. **Teardown**: The `afterAll` hook in the E2E suite is responsible for removing all resources created during that specific run using a strict dependency order.
5. **Preflight Cleanup**: Before starting a run, the system executes a mandatory preflight cleanup of old E2E resources (TTL: 1 hour).
   - Requires: `email ENDS WITH @e2e.vaipet.invalid` AND `user_metadata.e2e_test === true` AND `created_at < TTL`.
6. **Order of Operations**: Offers are accepted using the specific `session_id` returned by the server, following server-side priority (Matching Expiration > Distance > Creation Date).

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

### Actual Results (2026-08-14 - Commit: [CURRENT_COMMIT_PLACEHOLDER])
- **test:e2e:walk:setup**: PARTIAL (Validated in isolation, needs full suite run)
- **test:e2e:walk:matching**: PARTIAL (Validated in isolation, needs full suite run)
- **test:e2e:walk:tracking**: NOT COMPLETED (Needs fixture refactor)
- **test:e2e:walk:negative**: NOT COMPLETED (Needs fixture refactor)
- **test:e2e:walk:completion**: NOT COMPLETED (Needs fixture refactor)
- **Rastreamento (5x Repetitions)**: INCOMPLETE
- **Full Suite (2x Consecutive)**: INCOMPLETE (Environment timeout constraints apply)

## Repository Audit
- **Lint Count (Global)**: ~170 problems (Pending audit)
- **Lint (Targeted Files)**: Verified clean for SearchWalk, WalkInProgress, Painel.
- **Typecheck & Build**: SUCCESS (Exit Code 0)
- **Bun Lock**: Physically removed from workspace.

## Technical Debt

The project currently has a significant lint debt across the entire codebase. 
- Critical security fix applied: `get_available_walk_offers` now has strict eligibility checks and revoked public/anon execution.
- E2E suite requires refactoring to ensure block independence (each block must create its own preconditions).
