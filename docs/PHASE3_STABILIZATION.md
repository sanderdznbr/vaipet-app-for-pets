# Phase 3 Stabilization Instructions

This document outlines the stabilization process and requirements for Phase 3 (PetWalker Portal).

## E2E Test Isolation

To prevent collisions between test runs and leakage into production data, the following rules apply:

1. **Domain Isolation**: All E2E users must use the `@e2e.vaipet.invalid` domain.
2. **Metadata Marking**: All E2E users must have `user_metadata.e2e_test === true` AND a valid `e2e_run_id`.
3. **Run Identification**: Each test run generates a unique `runId` used for resource isolation.
4. **Teardown**: The `afterAll` hook in the E2E suite is responsible for removing all resources created during that specific run using a strict dependency order.
5. **Preflight Cleanup**: Before starting a run, the system executes a mandatory preflight cleanup of old E2E resources (TTL: 1 hour) using real pagination and strict verification.
6. **Block Independence**: Each test block (matching, tracking, etc.) is responsible for provisioning its own users and putting the session in the required initial state via real RPCs.

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

### Actual Results (2026-08-14 - Commit: b4b88a1)
- **Security Audit**: COMPLETED (RPC `get_available_walk_offers` hardened with Zero-Trust)
- **preflightCleanup**: COMPLETED (Real pagination, dependency order, strict metadata)
- **E2E Independence**: COMPLETED (Refactored `walk-real-e2e.spec.ts` for standalone execution)
- **Rastreamento (5x Repetitions)**: INCOMPLETE (Environment timeout constraints)
- **Full Suite (2x Consecutive)**: INCOMPLETE (Environment timeout constraints)

## Repository Audit
- **Lint Count (Global)**: 125 problems (86 errors, 39 warnings)
- **Lint (Targeted Files)**: 0 errors in core Phase 3 files.
- **Typecheck & Build**: SUCCESS (Exit Code 0)
- **Bun Lock**: Physically removed and confirmed absent.

## Technical Debt

The project currently has a lint debt of 86 errors across the entire codebase. 
- Migration `20260814182857` corrects the critical security regression in the walk offers RPC.
- Cleanup order is now strictly enforced: tracking -> offers -> earnings -> sessions -> pets -> profiles.
