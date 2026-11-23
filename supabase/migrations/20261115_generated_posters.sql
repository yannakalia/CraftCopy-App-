-- =====================================================================
-- CraftCopy Permanent Poster Storage & Database Integration
-- Safe, idempotent migration: preserves all existing tables and data.
-- =====================================================================

-- 1. Create the "generated_posters" table
CREATE TABLE IF NOT EXISTS public.generated_posters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_name TEXT DEFAULT '',
  business_name TEXT DEFAULT '',
  product_name TEXT DEFAULT '',
  poster_image_url TEXT NOT NULL,
  caption TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for fast newest-first retrieval
CREATE INDEX IF NOT EXISTS idx_generated_posters_created_at
  ON public.generated_posters (created_at DESC);

-- Enable Row Level Security (RLS)
ALTER TABLE public.generated_posters ENABLE ROW LEVEL SECURITY;

-- Policies for public/anon and authenticated access
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'generated_posters'
      AND policyname = 'Allow public read generated_posters'
  ) THEN
    CREATE POLICY "Allow public read generated_posters"
      ON public.generated_posters
      FOR SELECT
      TO anon, authenticated
      USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'generated_posters'
      AND policyname = 'Allow public insert generated_posters'
  ) THEN
    CREATE POLICY "Allow public insert generated_posters"
      ON public.generated_posters
      FOR INSERT
      TO anon, authenticated
      WITH CHECK (true);
  END IF;
END $$;

-- 2. Create the public Storage bucket named "generated-posters"
INSERT INTO storage.buckets (id, name, public)
VALUES ('generated-posters', 'generated-posters', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Storage RLS policies on storage.objects for "generated-posters"
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Public read generated-posters bucket'
  ) THEN
    CREATE POLICY "Public read generated-posters bucket"
      ON storage.objects
      FOR SELECT
      TO public
      USING (bucket_id = 'generated-posters');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Allow upload to generated-posters bucket'
  ) THEN
    CREATE POLICY "Allow upload to generated-posters bucket"
      ON storage.objects
      FOR INSERT
      TO anon, authenticated
      WITH CHECK (bucket_id = 'generated-posters');
  END IF;
END $$;
