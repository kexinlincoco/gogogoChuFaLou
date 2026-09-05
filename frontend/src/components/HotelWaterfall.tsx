import type { HotelCandidate } from "../types";
import { HotelCard } from "./HotelCard";

// Purely cosmetic "N people found this helpful" seed, derived from the hotel
// id so it's stable across renders without needing backend state for it.
function likeBaseFor(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return 40 + (h % 180);
}

export function HotelWaterfall({
  hotels,
  onOpenHotel,
  onShowEvidence,
}: {
  hotels: HotelCandidate[];
  onOpenHotel: (hotelId: string) => void;
  onShowEvidence: (candidate: HotelCandidate) => void;
}) {
  return (
    <div style={{ columnCount: 2, columnGap: 10 }}>
      {hotels.map((c) => (
        <HotelCard
          key={c.hotel.id}
          candidate={c}
          likeBase={likeBaseFor(c.hotel.id)}
          onOpen={() => onOpenHotel(c.hotel.id)}
          onShowEvidence={() => onShowEvidence(c)}
        />
      ))}
    </div>
  );
}
