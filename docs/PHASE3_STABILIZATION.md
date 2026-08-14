# Phase 3 Stabilization Instructions

This document outlines the stabilization process and requirements for Phase 3 (PetWalker Portal).

## E2E Test Isolation

To prevent collisions between test runs and leakage into production data, the following rules apply:

1. **Domain Isolation**: All E2E users must use the `@e2e.vaipet.invalid` domain.
2. **Run Identification**: Each test run generates a unique `runId` used for resource naming (e.g., Pet names).
3. **Teardown**: The `afterAll` hook in the E2E suite is responsible for removing all resources created during that specific run.
4. **Preflight Cleanup**: Before starting a run, the system may perform a preflight cleanup of old E2E resources (older than a safe TTL) that use the reserved domain.

## Operational GPS Flow

The PetWalker application uses a single source of truth for location tracking:

1. **Producer**: `WalkInProgress.tsx` uses `navigator.geolocation.watchPosition`.
2. **Persistence**: The producer calls `update_walker_location` (for live marker) and `append_walk_tracking_point` (for historical trail).
3. **Consumer**: The Pet Owner's interface polls `get_active_walker_location` based on the database `session_status`, not UI animation state.

## Results Reporting

Stability is defined as:
- **Tracking**: 5/5 consecutive successful runs.
- **Full Suite**: 2/2 consecutive successful runs.
- **Failures/Retries**: Zero tolerated.

## Technical Debt

The project currently has a lint debt of approximately 176 errors across the entire codebase. This must be resolved before a "Ready for Production" classification can be granted.
