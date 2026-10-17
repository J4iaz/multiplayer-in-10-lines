# Supabase Setup Guide

## Prerequisites
- A [Supabase](https://supabase.com) account and project
- Node.js ≥ 20

## Step 1: Create a Supabase Project

1. Go to [app.supabase.com](https://app.supabase.com)
2. Click **New Project**
3. Choose a name, region, and database password
4. Wait for setup (~1 min)

## Step 2: Run the Schema

1. In your Supabase dashboard, go to **SQL Editor**
2. Copy the contents of `schema.sql`
3. Paste and click **Run**

This creates:
- `profiles` — user display name & avatar, auto-created on signup
- `rooms` — room metadata (owner, lock, password)
- `room_members` — per-room roles (owner/editor/viewer)
- `chat_messages` — persistent chat history
- `room_snapshots` — room state snapshots for persistence
- `room_events` — event log for history/replay

## Step 3: Configure Environment Variables

Copy `.env.example` to `.env` and fill in:

```bash
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=eyJhbGci...   # Safe for browser
SUPABASE_SERVICE_ROLE_KEY=eyJhbGci...  # SECRET — server only!
```

Find these in: **Project Settings → API**

> [!CAUTION]
> Never commit `.env` or expose `SUPABASE_SERVICE_ROLE_KEY` to the browser.

## Step 4: Self-host the Supabase JS Client

Download the UMD bundle for the browser:

```bash
curl -o public/vendor/supabase.js \
  https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js
```

Then add your public keys to `public/auth.html` before the `</head>` tag:

```html
<script>
  window._SUPABASE_URL = 'https://your-project.supabase.co';
  window._SUPABASE_ANON_KEY = 'eyJhbGci...your-anon-key...';
</script>
```

## Step 5: Enable Google OAuth (Optional)

1. In Supabase dashboard → **Authentication → Providers**
2. Enable **Google**
3. Create OAuth credentials in [Google Cloud Console](https://console.cloud.google.com)
4. Add your redirect URL: `https://your-project.supabase.co/auth/v1/callback`

## Row Level Security (RLS)

RLS is enabled on all tables. The schema includes basic policies for profiles. You'll want to add more policies for rooms/chat as you build out features.

Example policy for chat messages (allow members to read):

```sql
CREATE POLICY "Room members can read chat"
  ON public.chat_messages FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.room_members
      WHERE room_id = chat_messages.room_id
        AND user_id = auth.uid()
        AND banned = false
    )
  );
```

## Local Development

With no Supabase configured, the server runs in **dev mode**:
- Auth verification is skipped (all WebSocket connections are allowed)
- The auth page shows a warning notice
- Guest mode is enabled by default (`ALLOW_GUESTS=true`)
