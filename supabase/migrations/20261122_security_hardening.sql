-- =====================================================================
-- CraftCopy Database & Storage Security Hardening Migration
-- Safe & idempotent: preserves all existing tables and data.
-- Enforces strict structural validation, URL hygiene, and upload limits
-- without requiring user sign-in or breaking existing workflows.
-- =====================================================================

-- 1. Harden "generated_posters" RLS policies
ALTER TABLE IF EXISTS public.generated_posters ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public insert generated_posters" ON public.generated_posters;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'generated_posters'
  ) THEN
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

    -- Enforce non-empty seller_name, bounded field lengths, and safe HTTPS image URLs on insert
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'generated_posters'
        AND policyname = 'Allow validated insert generated_posters'
    ) THEN
      CREATE POLICY "Allow validated insert generated_posters"
        ON public.generated_posters
        FOR INSERT
        TO anon, authenticated
        WITH CHECK (
          length(trim(coalesce(seller_name, ''))) BETWEEN 1 AND 150
          AND length(coalesce(business_name, '')) <= 150
          AND length(coalesce(product_name, '')) <= 200
          AND length(coalesce(caption, '')) <= 5000
          AND poster_image_url ~* '^https://'
          AND length(poster_image_url) <= 2048
        );
    END IF;
  END IF;
END $$;

-- 2. Harden "generated-posters" Storage bucket & policies
UPDATE storage.buckets
SET
  public = true,
  file_size_limit = 10485760,
  allowed_mime_types = ARRAY['image/png', 'image/jpeg', 'image/webp']
WHERE id = 'generated-posters';

DROP POLICY IF EXISTS "Allow upload to generated-posters bucket" ON storage.objects;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Allow validated image upload to generated-posters bucket'
  ) THEN
    CREATE POLICY "Allow validated image upload to generated-posters bucket"
      ON storage.objects
      FOR INSERT
      TO anon, authenticated
      WITH CHECK (
        bucket_id = 'generated-posters'
        AND name ~* '^posters/[a-z0-9._-]+\.(png|jpg|jpeg|webp)$'
      );
  END IF;
END $$;

-- 3. Harden "public.products" if RLS is active or enabled (safe, preserves existing records)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'products'
  ) THEN
    ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'products'
        AND policyname = 'Allow read products'
    ) THEN
      CREATE POLICY "Allow read products"
        ON public.products
        FOR SELECT
        TO anon, authenticated
        USING (true);
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'products'
        AND policyname = 'Allow validated insert products'
    ) THEN
      CREATE POLICY "Allow validated insert products"
        ON public.products
        FOR INSERT
        TO anon, authenticated
        WITH CHECK (
          length(trim(coalesce(product_name, ''))) BETWEEN 1 AND 200
          AND length(coalesce(owner_name, '')) <= 150
          AND length(coalesce(product_details, '')) <= 5000
          AND (
            coalesce(photo_url, '') = ''
            OR photo_url ~* '^(https://|/uploads/|data:image/(png|jpeg|jpg|webp|gif);base64,)'
          )
        );
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'products'
        AND policyname = 'Allow validated update products'
    ) THEN
      CREATE POLICY "Allow validated update products"
        ON public.products
        FOR UPDATE
        TO anon, authenticated
        USING (true)
        WITH CHECK (
          length(trim(coalesce(product_name, ''))) BETWEEN 1 AND 200
          AND length(coalesce(owner_name, '')) <= 150
          AND length(coalesce(product_details, '')) <= 5000
          AND (
            coalesce(photo_url, '') = ''
            OR photo_url ~* '^(https://|/uploads/|data:image/(png|jpeg|jpg|webp|gif);base64,)'
          )
        );
    END IF;
  END IF;
END $$;
