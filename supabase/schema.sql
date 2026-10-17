-- Multiplayer in 10 Lines — Supabase Schema
-- Run in Supabase SQL Editor

-- Profiles (created automatically on signup via trigger)
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  display_name text NOT NULL DEFAULT 'Guest',
  avatar jsonb DEFAULT '{"kind":"initials"}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own profile" ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Users insert own profile" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);

-- Rooms
CREATE TABLE IF NOT EXISTS public.rooms (
  id text PRIMARY KEY,
  owner_id uuid REFERENCES auth.users ON DELETE SET NULL,
  name text,
  password_hash text,
  locked boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  last_active_at timestamptz DEFAULT now()
);
ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;

-- Room members
CREATE TABLE IF NOT EXISTS public.room_members (
  room_id text REFERENCES public.rooms(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'editor' CHECK (role IN ('owner','editor','viewer')),
  banned boolean DEFAULT false,
  PRIMARY KEY (room_id, user_id)
);
ALTER TABLE public.room_members ENABLE ROW LEVEL SECURITY;

-- Chat messages
CREATE TABLE IF NOT EXISTS public.chat_messages (
  id bigserial PRIMARY KEY,
  room_id text NOT NULL,
  user_id uuid REFERENCES auth.users ON DELETE SET NULL,
  display_name text NOT NULL,
  body text NOT NULL,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

-- Room snapshots (for persistence)
CREATE TABLE IF NOT EXISTS public.room_snapshots (
  room_id text PRIMARY KEY,
  version bigint NOT NULL DEFAULT 0,
  state jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.room_snapshots ENABLE ROW LEVEL SECURITY;

-- Room events (for history/replay)
CREATE TABLE IF NOT EXISTS public.room_events (
  id bigserial PRIMARY KEY,
  room_id text NOT NULL,
  version bigint NOT NULL,
  user_id uuid REFERENCES auth.users ON DELETE SET NULL,
  type text NOT NULL,
  payload jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.room_events ENABLE ROW LEVEL SECURITY;

-- Trigger: auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1))
  ) ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
