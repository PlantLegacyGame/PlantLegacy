/**
 * What each item looks like.
 *
 * The shop printed a glyph per item (a diamond, a circle, a flower) and the pouch
 * printed only its name, so the two surfaces disagreed and neither was a drawing
 * (play-test 2026-11-26: "the inventory icons are not correct like the ones in
 * shop, not just abstract shapes or rhombuses"). One line drawing per item id,
 * shared by the shop, the pouch and the hotbar, so an item looks the same
 * everywhere it appears and can be recognised without reading.
 *
 * Drawn as inline SVG with `currentColor` for the ink: the panels tint their own
 * context, and a sprite sheet would have to be recoloured per surface.
 */

export type ItemIconKind =
  | 'fertilizer'
  | 'dung'
  | 'essence'
  | 'seed'
  | 'booster'
  | 'spore'
  | 'water'
  | 'wood'
  | 'leaf';

/**
 * The drawing an item gets, from its id first and its category second.
 *
 * Ids are the server's (`config/items.json`); categories catch an item that is
 * added later without a drawing of its own.
 */
export function itemIconKind(itemId: string, category?: string): ItemIconKind {
  const id = itemId.toLowerCase();
  const cat = (category ?? '').toLowerCase();
  if (id.includes('dung') || cat === 'dung') return 'dung';
  if (id.includes('fertilizer') || id.includes('fertiliser') || cat === 'fertilizer')
    return 'fertilizer';
  if (id.includes('essence') || cat === 'essence') return 'essence';
  if (id.includes('booster') || cat === 'booster') return 'booster';
  if (id.includes('seed') || cat.endsWith('_seed')) return 'seed';
  if (id.includes('spore') || cat === 'spore') return 'spore';
  if (id.includes('water') || cat === 'water') return 'water';
  if (id.includes('wood') || id.includes('bark') || cat === 'wood') return 'wood';
  return 'leaf';
}

const DRAWINGS: Record<ItemIconKind, string> = {
  // A sack, cinched at the neck, with a scoop of worked soil at its foot.
  fertilizer:
    '<path d="M8.4 8.2 12 5.2l3.6 3v2.1l1.6 6.1a2.4 2.4 0 0 1-2.3 3H9.1a2.4 2.4 0 0 1-2.3-3l1.6-6.1Z"/>' +
    '<path d="M9.2 12.6h5.6M9.9 15.4h4.2" opacity=".55"/>' +
    '<path d="M8.2 8.2c1.1.9 2.4 1.3 3.8 1.3s2.7-.4 3.8-1.3" opacity=".55"/>',
  // A coil of dung: three stacked arcs, narrowing upward.
  dung:
    '<path d="M5.6 17.6c0-1.7 2.9-3 6.4-3s6.4 1.3 6.4 3-2.9 2.4-6.4 2.4-6.4-.7-6.4-2.4Z"/>' +
    '<path d="M7.8 14.6c0-1.3 1.9-2.3 4.2-2.3s4.2 1 4.2 2.3" opacity=".7"/>' +
    '<path d="M10.2 11.8c0-.9  .8-1.6 1.8-1.6s1.8.7 1.8 1.6" opacity=".5"/>',
  // A stoppered bottle, half full, with the growth it holds rising out of it.
  essence:
    '<path d="M10 3.6h4v2.2l1.9 4.1a3.4 3.4 0 0 1-3.1 4.9h-1.6a3.4 3.4 0 0 1-3.1-4.9L10 5.8Z"/>' +
    '<path d="M8.2 13.2h7.6" opacity=".55"/>' +
    '<path d="M12 9.6c1.1-1.3 1.1-2.6 0-3.6" opacity=".5"/>',
  // A seed with a sprout: the same mark for both seed kinds.
  seed:
    '<path d="M12 20c3.3 0 5.4-2.4 5.4-5.2S14.8 9.2 12 9.2 6.6 12 6.6 14.8 8.7 20 12 20Z"/>' +
    '<path d="M12 9.2V6.4"/>' +
    '<path d="M12 6.4c0-1.9 1.5-3.3 3.4-3.3 0 1.9-1.5 3.3-3.4 3.3Z"/>' +
    '<path d="M12 6.4c0-1.6-1.3-2.9-2.9-2.9 0 1.6 1.3 2.9 2.9 2.9Z" opacity=".65"/>',
  // A flask, for the gene compound.
  booster:
    '<path d="M10.2 3.6h3.6v3.1l3.1 8.2a2.6 2.6 0 0 1-2.4 3.5H9.5a2.6 2.6 0 0 1-2.4-3.5l3.1-8.2Z"/>' +
    '<path d="M8.6 13.6h6.8" opacity=".55"/>' +
    '<circle cx="11" cy="16.6" r=".7" opacity=".7"/><circle cx="13.6" cy="15.6" r=".5" opacity=".5"/>',
  // A puff of spores: three floating motes over a rising cloud.
  spore:
    '<path d="M6.6 15.8c-1.6 0-2.8-1.1-2.8-2.5s1.2-2.5 2.8-2.5c.3-2.1 2.1-3.6 4.3-3.6 1.9 0 3.5 1.1 4.1 2.7 2 .1 3.6 1.4 3.6 3.1 0 1.7-1.6 2.8-3.6 2.8Z"/>' +
    '<circle cx="8" cy="4.6" r=".9"/><circle cx="13.4" cy="3.4" r=".7"/><circle cx="17.6" cy="6.2" r=".8"/>',
  // A drop.
  water:
    '<path d="M12 3.4c3.3 4.1 5.2 6.9 5.2 9.4A5.2 5.2 0 0 1 12 18a5.2 5.2 0 0 1-5.2-5.2c0-2.5 1.9-5.3 5.2-9.4Z"/>' +
    '<path d="M9.4 13.2c0 1.5 1.1 2.7 2.6 2.7" opacity=".5"/>',
  // A split log, for timber.
  wood:
    '<path d="M4.4 8.6h9.2a6 6 0 0 1 0 8H4.4Z"/>' +
    '<ellipse cx="16.4" cy="12.6" rx="3.2" ry="4"/>' +
    '<path d="M16.4 10.6c1 .5 1.6 1.2 1.6 2" opacity=".45"/>',
  // A leaf, for anything new.
  leaf:
    '<path d="M19.4 4.6C12 4 5.6 7.4 5.6 13.4a5.6 5.6 0 0 0 9.4 4.2c4-3.6 4-9 4.4-13Z"/>' +
    '<path d="M7.6 16.8c2.4-3 5-4.8 8.4-6.2" opacity=".5"/>',
};

/**
 * The drawing as an inline SVG string, ready for `innerHTML`.
 *
 * `size` is the box in CSS pixels; the stroke follows it so a 14 px icon in a
 * slot and a 30 px icon in the shop keep the same line weight as the type.
 */
export function itemIconSvg(
  itemId: string,
  options: { size?: number; category?: string } = {},
): string {
  const kind = itemIconKind(itemId, options.category);
  const size = Math.max(10, Math.round(options.size ?? 20));
  const stroke = size >= 24 ? 1.5 : 1.7;
  return (
    '<svg class="pl-item-icon" viewBox="0 0 24 24" width="' +
    size +
    '" height="' +
    size +
    '"' +
    ' fill="none" stroke="currentColor" stroke-width="' +
    stroke +
    '"' +
    ' stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
    DRAWINGS[kind] +
    '</svg>'
  );
}
