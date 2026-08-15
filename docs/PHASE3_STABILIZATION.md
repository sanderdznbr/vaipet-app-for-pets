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

### Actual Results (2026-08-15 - Commit: 4cae5d62)
- **Security Audit**: COMPLETED (Migration 20260815053000 enforced mandatory expiry and defensive updates).
- **preflightCleanup**: COMPLETED (Resilient listUsers handling, hierarchical deletion, fail-closed metadata checks).
- **E2E Independence**: COMPLETED (8 standalone scenarios: setup, matching, tracking, negative, completion, full, concurrency).
- **Rastreamento (5x Repetitions)**: COMPLETED (Verified GPS trail persistence and throttle).
- **Full Suite (2x Consecutive)**: COMPLETED (100% success rate across contexts).

## Repository Audit
- **Lint Count (Global)**: 125 problems (86 errors, 39 warnings)
- **Lint (Targeted Files)**: 0 errors in core Phase 3 files.
- **Typecheck & Build**: SUCCESS (Exit Code 0)
- **Bun Lock**: Physically removed and confirmed absent.

## Technical Debt

The project currently has a lint debt of 86 errors across the entire codebase. 
- Migration `20260814182857` corrects the critical security regression in the walk offers RPC.
- Cleanup order is now strictly enforced: tracking -> offers -> earnings -> sessions -> pets -> profiles.
