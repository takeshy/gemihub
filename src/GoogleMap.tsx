import { tr, getLocale } from "../shared/i18n";
import type { ShopConfig } from "../server/domain";

/** The place shown on the map: the configured query, or the shop address. */
export const mapQuery = (config: Pick<ShopConfig, "map" | "address">) => (config.map?.query || config.address).trim();
/** Google Maps URLs that need no API key: an embeddable map and the "open in Maps" search link. */
export const mapEmbedUrl = (query: string) => `https://maps.google.com/maps?q=${encodeURIComponent(query)}&hl=${getLocale()}&z=16&output=embed`;
export const mapOpenUrl = (query: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;

/** The access-section map, shown only when the owner turned it on and a place is known. */
export function GoogleMap({ config }: { config: Pick<ShopConfig, "map" | "address" | "name"> }) {
  const query = mapQuery(config);
  if (!config.map?.enabled || !query) return null;
  return <figure className="shop-map">
    <iframe src={mapEmbedUrl(query)} title={tr("{0}の地図", config.name)} loading="lazy" referrerPolicy="no-referrer-when-downgrade" allowFullScreen />
    <figcaption><a href={mapOpenUrl(query)} target="_blank" rel="noopener noreferrer">{tr("Google マップで開く")} ↗</a></figcaption>
  </figure>;
}
