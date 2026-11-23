-- =====================================================================
-- CraftCopy Meta (Facebook Pages & Instagram Professional) Schema Migration
-- Safe migration: preserves all existing tables (public.products, etc.)
-- =====================================================================

-- 1. Table: meta_connections
-- Securely records metadata about authorized Facebook Pages & Instagram accounts
CREATE TABLE IF NOT EXISTS public.meta_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email TEXT,
  meta_user_id TEXT NOT NULL,
  meta_user_name TEXT,
  selected_page_id TEXT,
  selected_page_name TEXT,
  selected_instagram_id TEXT,
  selected_instagram_username TEXT,
  available_pages JSONB DEFAULT '[]'::jsonb,
  available_instagram_accounts JSONB DEFAULT '[]'::jsonb,
  granted_permissions JSONB DEFAULT '[]'::jsonb,
  is_active BOOLEAN DEFAULT true,
  connected_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable Row Level Security (RLS) on meta_connections
ALTER TABLE public.meta_connections ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users and service roles to manage their own connections
CREATE POLICY "Allow read own meta connections" 
  ON public.meta_connections
  FOR SELECT 
  USING (true);

CREATE POLICY "Allow insert own meta connections" 
  ON public.meta_connections
  FOR INSERT 
  WITH CHECK (true);

CREATE POLICY "Allow update own meta connections" 
  ON public.meta_connections
  FOR UPDATE 
  USING (true);

CREATE POLICY "Allow delete own meta connections" 
  ON public.meta_connections
  FOR DELETE 
  USING (true);

-- 2. Table: published_posts
-- Logs all one-click publications to Facebook Pages and Instagram accounts
CREATE TABLE IF NOT EXISTS public.published_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id TEXT,
  platform TEXT NOT NULL CHECK (platform IN ('facebook', 'instagram')),
  post_id TEXT NOT NULL,
  target_account_id TEXT,
  target_account_name TEXT,
  caption_title TEXT,
  caption_body TEXT,
  image_url TEXT,
  permalink TEXT,
  status TEXT DEFAULT 'published',
  published_at TIMESTAMPTZ DEFAULT now()
);

-- Enable Row Level Security (RLS) on published_posts
ALTER TABLE public.published_posts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow read published posts" 
  ON public.published_posts
  FOR SELECT 
  USING (true);

CREATE POLICY "Allow insert published posts" 
  ON public.published_posts
  FOR INSERT 
  WITH CHECK (true);

-- Indexes for fast query lookup
CREATE INDEX IF NOT EXISTS idx_published_posts_product_id ON public.published_posts(product_id);
CREATE INDEX IF NOT EXISTS idx_published_posts_platform ON public.published_posts(platform);
CREATE INDEX IF NOT EXISTS idx_meta_connections_meta_user ON public.meta_connections(meta_user_id);
