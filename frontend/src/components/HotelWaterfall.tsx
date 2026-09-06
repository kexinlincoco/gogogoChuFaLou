import type { HotelCandidate } from "../types";
import { HotelCard } from "./HotelCard";

export function HotelWaterfall({
  hotels,
  prefer,
  onOpenHotel,
  onShowEvidence,
}: {
  hotels: HotelCandidate[];
  prefer: string[];
  onOpenHotel: (hotelId: string) => void;
  onShowEvidence: (candidate: HotelCandidate) => void;
}) {
  return (
    <div style={{ columnCount: 2, columnGap: 10 }}>
      {hotels.map((c) => (
        <HotelCard
          key={c.hotel.id}
          candidate={c}
          prefer={prefer}
          onOpen={() => onOpenHotel(c.hotel.id)}
          onShowEvidence={() => onShowEvidence(c)}
        />
      ))}
    </div>
  );
}
