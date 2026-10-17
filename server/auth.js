'use strict';

/**
 * server/auth.js — JWT verification via Supabase.
 * If SUPABASE_SERVICE_ROLE_KEY is not configured, verification is skipped (dev mode).
 */

let supabaseAdmin = null;

function init() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && key) {
    try {
      const { createClient } = require('@supabase/supabase-js');
      supabaseAdmin = createClient(url, key, {
        auth: { autoRefreshToken: false, persistSession: false }
      });
      console.log('[auth] Supabase admin client ready');
    } catch (e) {
      console.warn('[auth] Supabase init failed:', e.message);
    }
  } else {
    console.warn('[auth] No SUPABASE_SERVICE_ROLE_KEY — auth verification disabled (dev mode)');
  }
}

/**
 * Verify a Supabase access token.
 * Returns { user } on success, { error } on failure.
 * If Supabase is not configured, returns { user: null } (allow in dev).
 */
async function verifyToken(token) {
  if (!supabaseAdmin) {
    return { user: null }; // dev mode — no verification
  }
  if (!token || typeof token !== 'string') {
    return { error: 'missing_token' };
  }
  try {
    const { data, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !data.user) return { error: 'invalid_token' };
    return { user: data.user };
  } catch (e) {
    return { error: 'token_error' };
  }
}

module.exports = { init, verifyToken };
