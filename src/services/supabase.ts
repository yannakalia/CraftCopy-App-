import { ProductInput, GeneratedPosterRecord } from '../types';

let serverConfiguredCache: boolean | null = null;
let detectedColumns: string[] | null = null;
let sampleRow: Record<string, any> | null = null;

/**
 * Check if a string is a standard UUID format
 */
export function isUuid(str: string): boolean {
  if (!str || typeof str !== 'string') return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}

/**
 * Checks if Supabase is configured on the backend server.
 * Note: Supabase URL and keys are kept strictly on the server for privacy and security.
 */
export function isSupabaseConfigured(): boolean {
  return serverConfiguredCache !== false;
}

export async function checkServerSupabaseConfigured(): Promise<boolean> {
  try {
    const res = await fetch('/api/supabase/config');
    if (res.ok) {
      const data = await res.json();
      serverConfiguredCache = Boolean(data?.configured);
      return serverConfiguredCache;
    }
  } catch {
    // ignore network errors
  }
  return false;
}

export function getDetectedColumns(): string[] | null {
  return detectedColumns;
}

export function getSampleRow(): Record<string, any> | null {
  return sampleRow;
}

/**
 * Map a raw database record from public.products into CraftCopy's ProductInput
 */
export function mapRowToProduct(row: any): ProductInput {
  const costVal =
    row.cost ??
    row.cost_details?.materialsCost ??
    row.costDetails?.materialsCost ??
    row.materials_cost ??
    row.materialsCost ??
    null;
  const cost = costVal !== undefined && costVal !== null ? Number(costVal) : null;

  const priceVal = row.price ?? row.current_price ?? row.currentPrice;
  const currentPrice = priceVal !== undefined && priceVal !== null ? Number(priceVal) : null;

  const name = row.product_name || row.name || row.title || 'Handcrafted Creation';
  const ownerName = row.owner_name || row.ownerName || '';
  const productDetails = row.product_details || row.productDetails || row.story || row.description || '';
  const photoUrl = row.photo_url || row.photoUrl || row.image_url || row.imageUrl || row.image || '';

  return {
    id: String(row.id || `craft-${Date.now()}`),
    name,
    ownerName,
    productDetails,
    category: row.category || row.product_category || 'Handcrafted Goods',
    currentPrice,
    cost,
    materials: row.materials || row.material || '',
    story: productDetails,
    craftTechnique: row.craft_technique || row.craftTechnique || row.technique || '',
    photoUrl,
    caption: row.caption || '',
    productDescription: row.product_description || '',
    productIdea: row.product_idea || '',
    costDetails: {
      materialsCost: cost ?? 0,
      laborHours: 0,
      hourlyRate: 180,
      overheadCost: 0,
      targetMarginPercent: 30,
    },
  };
}

/**
 * Fetch all existing products from public.products via protected server API.
 * IMPORTANT: Does NOT delete or modify any existing product records.
 */
export async function fetchSupabaseProducts(): Promise<{
  success: boolean;
  products: ProductInput[];
  rawCount: number;
  error?: string;
  isConfigured: boolean;
}> {
  try {
    const res = await fetch('/api/products');
    const data = await res.json().catch(() => null);

    if (!data) {
      return {
        success: false,
        products: [],
        rawCount: 0,
        isConfigured: false,
        error: `Unexpected server response (HTTP ${res.status}).`,
      };
    }

    serverConfiguredCache = Boolean(data.isConfigured);

    if (!res.ok || !data.success) {
      return {
        success: false,
        products: [],
        rawCount: 0,
        isConfigured: Boolean(data.isConfigured),
        error: data.error || `Failed to load products (HTTP ${res.status}).`,
      };
    }

    const rows = Array.isArray(data.rows) ? data.rows : [];
    if (rows.length > 0) {
      detectedColumns = Object.keys(rows[0]);
      sampleRow = rows[0];
    }

    const mapped = rows.map(mapRowToProduct);
    return {
      success: true,
      products: mapped,
      rawCount: rows.length,
      isConfigured: true,
    };
  } catch (err: any) {
    console.error('Failed to query Supabase products via server API:', err);
    return {
      success: false,
      products: [],
      rawCount: 0,
      error: err?.message || 'Failed to connect to CraftCopy server',
      isConfigured: true,
    };
  }
}

/**
 * Builds payload matching the exact columns of public.products table
 */
export function buildInsertPayload(
  product: ProductInput,
  _cols?: string[] | null,
  _sample?: Record<string, any> | null
): Record<string, any> {
  const payload: Record<string, any> = {};

  const enteredName = (product.name || (product as any).product_name || (product as any).title || '').trim();
  payload.product_name = enteredName;

  const enteredOwner = (product.ownerName || (product as any).owner_name || '').trim();
  payload.owner_name = enteredOwner;

  const enteredDetails = (
    product.productDetails ||
    (product as any).product_details ||
    product.story ||
    (product.materials ? `Materials: ${product.materials}${product.craftTechnique ? ` | Technique: ${product.craftTechnique}` : ''}` : '') ||
    ''
  ).trim();
  payload.product_details = enteredDetails;

  const enteredPhoto = (product.photoUrl || (product as any).photo_url || (product as any).image_url || '').trim();
  payload.photo_url = enteredPhoto;

  let rawCost: number | null = null;
  if (product.cost !== null && product.cost !== undefined && String(product.cost).trim() !== '') {
    rawCost = Number(product.cost);
  } else if (
    (product as any).costDetails?.materialsCost !== undefined &&
    (product as any).costDetails?.materialsCost !== null &&
    (product as any).costDetails?.materialsCost !== 0
  ) {
    rawCost = Number((product as any).costDetails.materialsCost);
  }
  if (rawCost !== null && isNaN(rawCost)) rawCost = null;
  payload.cost = rawCost;

  let rawPrice: number | null = null;
  if (product.currentPrice !== null && product.currentPrice !== undefined && String(product.currentPrice).trim() !== '') {
    rawPrice = Number(product.currentPrice);
  } else if ((product as any).price !== null && (product as any).price !== undefined && String((product as any).price).trim() !== '') {
    rawPrice = Number((product as any).price);
  }
  if (rawPrice !== null && isNaN(rawPrice)) rawPrice = null;
  payload.price = rawPrice;

  payload.caption = (product.caption || (product as any).caption || '').trim() || null;
  payload.product_description = (product.productDescription || (product as any).product_description || '').trim() || null;
  payload.product_idea = (product.productIdea || (product as any).product_idea || '').trim() || null;
  payload.created_at = new Date().toISOString();

  delete payload.id;
  return payload;
}

/**
 * Inserts a newly created product into public.products via protected server API.
 */
export async function insertProductToSupabase(product: ProductInput): Promise<{
  success: boolean;
  product?: ProductInput;
  insertedId?: string;
  error?: string;
  isConfigured: boolean;
}> {
  try {
    const res = await fetch('/api/products', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ product }),
    });

    const data = await res.json().catch(() => null);
    if (!data) {
      return {
        success: false,
        isConfigured: true,
        error: `Unexpected server response (HTTP ${res.status}).`,
      };
    }

    serverConfiguredCache = Boolean(data.isConfigured ?? true);

    if (!res.ok || !data.success) {
      return {
        success: false,
        isConfigured: Boolean(data.isConfigured ?? true),
        error: data.error || `Failed to save product (HTTP ${res.status}).`,
      };
    }

    const resultProduct = data.row ? mapRowToProduct(data.row) : { ...product };
    return {
      success: true,
      product: resultProduct,
      insertedId: String(data.insertedId || resultProduct.id || ''),
      isConfigured: true,
    };
  } catch (err: any) {
    console.error('Error inserting product via server API:', err);
    return {
      success: false,
      error: err?.message || 'Failed to insert product into Supabase',
      isConfigured: true,
    };
  }
}

/**
 * Saves or updates the latest caption in Supabase public.products via protected server API.
 */
export async function saveCaptionToSupabase(
  product: ProductInput,
  caption: string
): Promise<{ success: boolean; product?: ProductInput; error?: string }> {
  const cleanCaption = caption.trim();
  const updatedProduct: ProductInput = {
    ...product,
    caption: cleanCaption,
  };

  if (product.id && isUuid(product.id)) {
    try {
      const res = await fetch(`/api/products/${encodeURIComponent(product.id)}/caption`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caption: cleanCaption }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.success && data?.row) {
        return {
          success: true,
          product: mapRowToProduct(data.row),
        };
      }
    } catch (err) {
      console.warn('Supabase caption update error via server API, attempting insert:', err);
    }
  }

  const insertRes = await insertProductToSupabase(updatedProduct);
  return {
    success: insertRes.success,
    product: insertRes.product || updatedProduct,
    error: insertRes.error,
  };
}

/**
 * Updates an existing product record in public.products via protected server API.
 */
export async function updateProductInSupabase(
  product: ProductInput
): Promise<{ success: boolean; product?: ProductInput; error?: string }> {
  if (!product.id || !isUuid(product.id)) {
    const insertRes = await insertProductToSupabase(product);
    return {
      success: insertRes.success,
      product: insertRes.product || product,
      error: insertRes.error,
    };
  }

  try {
    const res = await fetch(`/api/products/${encodeURIComponent(product.id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ product }),
    });
    const data = await res.json().catch(() => null);

    if (!res.ok || !data?.success) {
      return {
        success: false,
        error: data?.error || `Failed to update product (HTTP ${res.status}).`,
      };
    }

    return {
      success: true,
      product: data.row ? mapRowToProduct(data.row) : product,
    };
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || 'Failed to update product in Supabase',
    };
  }
}

// ---------------------------------------------------------------------------
// Generated Posters Storage ("generated-posters") & Table ("generated_posters")
// ---------------------------------------------------------------------------

export const GENERATED_POSTERS_BUCKET = 'generated-posters';
export const GENERATED_POSTERS_TABLE = 'generated_posters';

export const GENERATED_POSTERS_SETUP_SQL = `-- Run in Supabase SQL Editor (safe, preserves existing tables & data)
CREATE TABLE IF NOT EXISTS public.generated_posters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_name TEXT DEFAULT '',
  business_name TEXT DEFAULT '',
  product_name TEXT DEFAULT '',
  poster_image_url TEXT NOT NULL,
  caption TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_generated_posters_created_at
  ON public.generated_posters (created_at DESC);

ALTER TABLE public.generated_posters ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public insert generated_posters" ON public.generated_posters;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'generated_posters' AND policyname = 'Allow public read generated_posters'
  ) THEN
    CREATE POLICY "Allow public read generated_posters"
      ON public.generated_posters FOR SELECT TO anon, authenticated USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'generated_posters' AND policyname = 'Allow validated insert generated_posters'
  ) THEN
    CREATE POLICY "Allow validated insert generated_posters"
      ON public.generated_posters FOR INSERT TO anon, authenticated
      WITH CHECK (
        length(trim(coalesce(seller_name, ''))) BETWEEN 1 AND 150
        AND length(coalesce(business_name, '')) <= 150
        AND length(coalesce(product_name, '')) <= 200
        AND length(coalesce(caption, '')) <= 5000
        AND poster_image_url ~* '^https://'
        AND length(poster_image_url) <= 2048
      );
  END IF;
END $$;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('generated-posters', 'generated-posters', true, 10485760, ARRAY['image/png', 'image/jpeg', 'image/webp'])
ON CONFLICT (id) DO UPDATE
SET public = true,
    file_size_limit = 10485760,
    allowed_mime_types = ARRAY['image/png', 'image/jpeg', 'image/webp'];

DROP POLICY IF EXISTS "Allow upload to generated-posters bucket" ON storage.objects;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'Public read generated-posters bucket'
  ) THEN
    CREATE POLICY "Public read generated-posters bucket"
      ON storage.objects FOR SELECT TO public USING (bucket_id = 'generated-posters');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'Allow validated image upload to generated-posters bucket'
  ) THEN
    CREATE POLICY "Allow validated image upload to generated-posters bucket"
      ON storage.objects FOR INSERT TO anon, authenticated
      WITH CHECK (
        bucket_id = 'generated-posters'
        AND name ~* '^posters/[a-z0-9._-]+\\.(png|jpg|jpeg|webp)$'
      );
  END IF;
END $$;`;

function mapRowToGeneratedPoster(row: any): GeneratedPosterRecord {
  return {
    id: String(row.id || ''),
    seller_name: String(row.seller_name || ''),
    business_name: String(row.business_name || ''),
    product_name: String(row.product_name || ''),
    poster_image_url: String(row.poster_image_url || ''),
    caption: String(row.caption || ''),
    created_at: String(row.created_at || new Date().toISOString()),
  };
}

function blobToSafeImageDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const safeBlob =
      blob.type && blob.type.startsWith('image/')
        ? blob
        : new Blob([blob], { type: 'image/png' });
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === 'string' && reader.result.startsWith('data:image/')) {
        resolve(reader.result);
      } else {
        reject(new Error('Could not encode generated poster image for upload.'));
      }
    };
    reader.onerror = () => reject(new Error('Failed to read generated poster image.'));
    reader.readAsDataURL(safeBlob);
  });
}

/**
 * Retrieve all saved posters from Supabase "generated_posters" table via protected server API.
 */
export async function fetchGeneratedPostersFromSupabase(): Promise<{
  success: boolean;
  posters: GeneratedPosterRecord[];
  error?: string;
  isConfigured: boolean;
  setupRequired?: boolean;
}> {
  try {
    const res = await fetch('/api/posters');
    const data = await res.json().catch(() => null);

    if (!data) {
      return {
        success: false,
        posters: [],
        isConfigured: false,
        error: `Unexpected server response (HTTP ${res.status}).`,
      };
    }

    serverConfiguredCache = Boolean(data.isConfigured);

    if (!res.ok || !data.success) {
      return {
        success: false,
        posters: [],
        isConfigured: Boolean(data.isConfigured),
        setupRequired: Boolean(data.setupRequired),
        error: data.error || `Failed to load saved posters (HTTP ${res.status}).`,
      };
    }

    const posters = Array.isArray(data.posters)
      ? data.posters
          .map(mapRowToGeneratedPoster)
          .filter((p: GeneratedPosterRecord) => Boolean(p.poster_image_url && /^https:\/\//i.test(p.poster_image_url)))
      : [];

    return {
      success: true,
      posters,
      isConfigured: true,
    };
  } catch (err: any) {
    return {
      success: false,
      posters: [],
      isConfigured: true,
      error: err?.message || 'Failed to retrieve saved posters from server.',
    };
  }
}

/**
 * Upload the actual generated poster image through CraftCopy's protected server API
 * (strips EXIF/metadata, validates raster image, uploads to "generated-posters", and
 * inserts record into "generated_posters").
 */
export async function saveGeneratedPosterToSupabase(params: {
  sellerName: string;
  businessName: string;
  productName: string;
  imageBlob: Blob;
  caption: string;
}): Promise<{
  success: boolean;
  poster?: GeneratedPosterRecord;
  error?: string;
  isConfigured: boolean;
  setupRequired?: boolean;
}> {
  const cleanSellerName = (params.sellerName || '').trim();
  if (!cleanSellerName) {
    return {
      success: false,
      isConfigured: true,
      error: 'Owner Name from the Seller Information form is required before saving this poster.',
    };
  }

  if (!params.imageBlob || params.imageBlob.size < 500) {
    return {
      success: false,
      isConfigured: true,
      error: 'Generated poster image data is empty or invalid.',
    };
  }

  try {
    const imageDataUrl = await blobToSafeImageDataUrl(params.imageBlob);

    const res = await fetch('/api/posters/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sellerName: cleanSellerName,
        businessName: (params.businessName || '').trim(),
        productName: (params.productName || '').trim(),
        caption: (params.caption || '').trim(),
        imageDataUrl,
      }),
    });

    const data = await res.json().catch(() => null);
    if (!data) {
      return {
        success: false,
        isConfigured: true,
        error: `Unexpected server response (HTTP ${res.status}).`,
      };
    }

    if (!res.ok || !data.success || !data.poster) {
      return {
        success: false,
        isConfigured: Boolean(data.isConfigured ?? true),
        setupRequired: Boolean(data.setupRequired),
        error: data.error || `Failed to save poster (HTTP ${res.status}).`,
      };
    }

    const inserted = mapRowToGeneratedPoster(data.poster);
    if (!inserted.poster_image_url) {
      return {
        success: false,
        isConfigured: true,
        error: 'Poster uploaded, but could not verify the saved database record.',
      };
    }

    return {
      success: true,
      poster: inserted,
      isConfigured: true,
    };
  } catch (err: any) {
    return {
      success: false,
      isConfigured: true,
      error: err?.message || 'Failed to save poster details to Supabase.',
    };
  }
}
