/**
 * Turn-by-turn is somebody else's app: *we own the picture, they own the pin* [map.md §2]. These are
 * the hand-offs, walking, each a link the phone already knows how to open.
 *
 * A place's name goes with it; a person's never does. Their position leaves this app only because the
 * operator going to them tapped it, and their callsign does not need to go with it.
 */
export interface Handoff {
  label: string;
  href: string;
}

export function directionsTo(to: { lat: number; lon: number }, placeName: string | null = null): Handoff[] {
  const lat = to.lat.toFixed(6);
  const lon = to.lon.toFixed(6);
  const named = placeName ? `(${encodeURIComponent(placeName)})` : '';
  return [
    // Android's chooser: Organic Maps, OsmAnd, Google Maps or whatever this phone has, all open source or not.
    { label: 'Your map app', href: `geo:${lat},${lon}?q=${lat},${lon}${named}` },
    { label: 'Apple Maps', href: `https://maps.apple.com/?daddr=${lat},${lon}&dirflg=w` },
    { label: 'Google Maps', href: `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}&travelmode=walking` },
    { label: 'OpenStreetMap', href: `https://www.openstreetmap.org/directions?engine=fossgis_osrm_foot&route=%3B${lat}%2C${lon}` }
  ];
}
