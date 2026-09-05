/**
 * No real hotel photos are licensed for this mock dataset (PRD §8), so cards
 * show a theme-matched placeholder photo instead of a plain color block.
 * LoremFlickr resolves an English keyword query to a real stock photo — swap
 * this for a real photo CDN URL per hotel once real inventory is wired in;
 * nothing else needs to change since every caller just reads `hotel.imageUrl`.
 *
 * LoremFlickr picks a genuinely random photo on EVERY request by default —
 * without `?lock=`, the same hotel shows a different, unrelated photo on
 * every reload. `seed` (the hotel id) is hashed into a lock value so each
 * hotel keeps one consistent photo.
 */
function hashToLock(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (Math.imul(31, h) + seed.charCodeAt(i)) | 0;
  return Math.abs(h) % 100000;
}

export function buildImageUrl(query: string, seed: string, width = 640, height = 480): string {
  // LoremFlickr wants literal commas between tags and "+" for spaces inside a
  // tag — encodeURIComponent-ing the whole string (including the comma) 403s.
  const tags = (query || "hotel,room")
    .split(",")
    .map((t) => t.trim().replace(/\s+/g, "+"))
    .filter(Boolean)
    .join(",");
  const lock = hashToLock(seed);
  return `https://loremflickr.com/${width}/${height}/${tags}?lock=${lock}`;
}
