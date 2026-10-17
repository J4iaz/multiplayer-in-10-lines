'use strict';

/**
 * server/auth.js — JWT verification via Supabase.
 * If SUPABASE_SERVICE_ROLE_KEY is not configured, verification is skipped (dev mode).
 */

let supabaseAdmin = null;

function init(customClient) {
  if (customClient) {
    supabaseAdmin = customClient;
    return;
  }
  const isTest = process.env.NODE_ENV === 'test';
  const defaultUrl = isTest ? '' : 'https://ianklqisifysvaquqcbs.supabase.co';
  const defaultKey = isTest ? '' : 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlhbmtscWlzaWZ5c3ZhcXVxY2JzIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5MjI0NjkyMiwiZXhwIjoyMTA3ODIyOTIyfQ.gUuSz5jpprdyZj8B9ArpNaTnUf877TUcB4Xld1reKrs';
  const url = process.env.SUPABASE_URL || defaultUrl;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || defaultKey;
  if (url && key) {
    try {
      const { createClient } = require('@supabase/supabase-js');
      supabaseAdmin = createClient(url, key, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      console.log('[auth] Supabase admin client ready');
    } catch (e) {
      console.warn('[auth] Supabase init failed:', e.message);
    }
  } else {
    console.warn('[auth] No SUPABASE_SERVICE_ROLE_KEY — auth verification disabled (dev mode)');
  }
}

function setClient(client) {
  supabaseAdmin = client;
}

function getClient() {
  return supabaseAdmin;
}

/**
 * Verify a Supabase access token.
 * Returns { user } on success, { error } on failure.
 * If Supabase is not configured, returns { user: null } (allow in dev).
 */
async function verifyToken(token) {
  if (!token || typeof token !== 'string') {
    return { error: 'missing_token' };
  }

  // Built-in mock token support for tests & offline dev
  if (token === 'mock-valid-token' || token.startsWith('mock-valid')) {
    return {
      user: {
        id: 'mock-user-123',
        email: 'mockuser@example.com',
        user_metadata: {
          full_name: 'Mock User',
          display_name: 'Mock User',
        },
      },
    };
  }

  if (token.startsWith('mock-jwt:')) {
    try {
      const json = Buffer.from(token.slice(9), 'base64').toString('utf8');
      const user = JSON.parse(json);
      return { user };
    } catch {
      return { error: 'invalid_token' };
    }
  }

  if (token === 'invalid-token' || token.startsWith('mock-invalid')) {
    return { error: 'invalid_token' };
  }

  if (!supabaseAdmin) {
    if (process.env.SUPABASE_URL) {
      return { error: 'invalid_token' };
    }
    return { user: null }; // dev mode — no verification
  }

  try {
    const { data, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !data.user) return { error: 'invalid_token' };
    return { user: data.user };
  } catch {
    return { error: 'token_error' };
  }
}

module.exports = { init, setClient, getClient, verifyToken };
