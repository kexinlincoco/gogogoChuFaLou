/**
 * PRD §8: no real inventory/pricing API is available, so nightly price is
 * simulated from a hotel's base_price with a deterministic weekend markup
 * and a small per-(hotel,date) jitter — deterministic so the same query
 * doesn't show a different number on every refresh, "random" only in the
 * sense that it isn't a flat markup.
 */
function hash(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function isWeekendCheckin(checkin: string): boolean {
  const day = new Date(checkin + "T00:00:00").getDay(); // 0 Sun .. 6 Sat
  return day === 5 || day === 6; // Fri or Sat night
}

export function nightlyPrice(hotelId: string, basePrice: number, checkin: string): number {
  const weekendMarkup = isWeekendCheckin(checkin) ? 1.15 : 1;
  const jitterSeed = hash(`${hotelId}:${checkin}`) % 100; // 0-99
  const jitter = 0.95 + (jitterSeed / 99) * 0.1; // 0.95 - 1.05
  return Math.round((basePrice * weekendMarkup * jitter) / 10) * 10;
}

export function nightsBetween(checkin: string, checkout: string): number {
  const a = new Date(checkin + "T00:00:00").getTime();
  const b = new Date(checkout + "T00:00:00").getTime();
  const nights = Math.round((b - a) / 86_400_000);
  return Math.max(1, nights);
}

export function totalPrice(hotelId: string, basePrice: number, checkin: string, checkout: string): number {
  const nights = nightsBetween(checkin, checkout);
  return nightlyPrice(hotelId, basePrice, checkin) * nights;
}
