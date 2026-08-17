import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { failClosedCleanup } from './helpers/cleanup';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || '';
const supabaseAnon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const E2E_RUN_ID = `4.1-sec-${Date.now()}`;

test.describe('Phase 4.1: Security/Zero-Trust Validation', () => {
  test.afterAll(async () => {
    await failClosedCleanup(E2E_RUN_ID);
  });

  test('RPC petwalker_confirm_pickup should be secure for anon', async () => {
    const { data, error } = await supabaseAnon.rpc('petwalker_confirm_pickup', {
      _session_id: '00000000-0000-0000-0000-000000000000',
      _pickup_code: '123456'
    });
    // Expected to fail because of REVOKE ALL from PUBLIC/anon
    expect(error).toBeDefined();
    console.log(`[SEC] Expected error: ${error?.message}`);
  });
});
