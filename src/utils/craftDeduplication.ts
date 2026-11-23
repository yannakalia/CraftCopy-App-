import { SavedCraft } from '../types';

/**
 * Robustly deduplicates a list of SavedCraft items.
 * An item is considered duplicate if its craft id, product id, or reciprocal matching
 * has already been observed.
 */
export function deduplicateCrafts(crafts: SavedCraft[]): SavedCraft[] {
  if (!Array.isArray(crafts)) return [];

  const seenKeys = new Set<string>();
  const result: SavedCraft[] = [];

  for (const craft of crafts) {
    if (!craft) continue;
    const craftId = craft.id ? String(craft.id).trim() : '';
    const productId = craft.product?.id ? String(craft.product.id).trim() : '';

    // Check if either id has been seen as a craft id or product id
    const isDuplicate =
      (craftId && seenKeys.has(`c:${craftId}`)) ||
      (productId && seenKeys.has(`p:${productId}`)) ||
      (craftId && seenKeys.has(`p:${craftId}`)) ||
      (productId && seenKeys.has(`c:${productId}`));

    if (isDuplicate) {
      continue;
    }

    if (craftId) {
      seenKeys.add(`c:${craftId}`);
    }
    if (productId) {
      seenKeys.add(`p:${productId}`);
    }
    result.push(craft);
  }

  return result;
}
