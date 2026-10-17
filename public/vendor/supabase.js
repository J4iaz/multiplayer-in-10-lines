/**
 * public/vendor/supabase.js — Supabase JS Client placeholder
 *
 * HOW TO POPULATE:
 * ─────────────────────────────────────────────────────────────────
 * Option A (recommended for production):
 *   Download the Supabase JS v2 UMD bundle and place it here.
 *   Download from: https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js
 *
 *   curl -o public/vendor/supabase.js \
 *     https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js
 *
 * Option B (dev only):
 *   You can load it from CDN in auth.html — but this breaks the strict CSP.
 *   Only use for local development.
 *
 * After adding the real bundle, also set these in a <script> block before
 * loading vendor/supabase.js in auth.html:
 *
 *   window._SUPABASE_URL     = 'https://your-project.supabase.co';
 *   window._SUPABASE_ANON_KEY = 'eyJhbGci...your-anon-key...';
 *
 * The anon key is SAFE to expose to the browser (it's restricted by RLS).
 * NEVER expose the service role key on the client side.
 * ─────────────────────────────────────────────────────────────────
 */

// This file intentionally left empty until the Supabase bundle is added.
// The auth.html checks for window.supabase before attempting to initialize.
