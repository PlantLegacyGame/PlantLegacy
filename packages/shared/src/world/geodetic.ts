/**
 * Earth-style geographic coordinates for the spherical world.
 *
 * The simulation still runs in pole-local metres (`x`/`z` on the tangent plane
 * at the north pole, `y` above that plane). This module is the one translation
 * between those metres and the latitude/longitude/altitude a player reads or
 * types. The planet is the existing 100 km body, not Earth: "Earth-style" means
 * a spherical lat/lon grid with hemispheres, not WGS84.
 *
 * Latitude is +90 at the north pole and -90 at the south pole. Longitude is
 * -180..180, with east positive. The play area surrounds the north pole, so it
 * reads as a region near 90 N rather than a made-up local latitude.
 */

export interface GeodeticCoordinate {
  /** Degrees, -90..90. Positive is north. */
  latitudeDeg: number;
  /** Degrees, -180..180. Positive is east. */
  longitudeDeg: number;
  /** Metres above the base sphere. */
  altitudeM: number;
}

export interface LocalPoint {
  x: number;
  y: number;
  z: number;
}

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

export function clampLatitude(value: number): number {
  return Math.max(-90, Math.min(90, value));
}

/** Wrap to [-180, 180). 180 is kept as 180 so a typed antimeridian reads back. */
export function wrapLongitude(value: number): number {
  if (!Number.isFinite(value)) return 0;
  let wrapped = ((((value + 180) % 360) + 360) % 360) - 180;
  if (Object.is(wrapped, -180) && value > 0) wrapped = 180;
  return wrapped;
}

export function isLatitudeInRange(value: number): boolean {
  return Number.isFinite(value) && value >= -90 && value <= 90;
}

export function isLongitudeInRange(value: number): boolean {
  return Number.isFinite(value) && value >= -180 && value <= 180;
}

/**
 * A direction on the unit sphere to a latitude/longitude.
 *
 * The axes match `SphericalTileGrid`: the north pole is +Y, longitude 0 points
 * along +X, and east is +Z.
 */
export function geodeticToDirection(
  latitudeDeg: number,
  longitudeDeg: number,
): { x: number; y: number; z: number } {
  const lat = clampLatitude(latitudeDeg) * DEG;
  const lon = wrapLongitude(longitudeDeg) * DEG;
  const cosLat = Math.cos(lat);
  return {
    x: cosLat * Math.cos(lon),
    y: Math.sin(lat),
    z: cosLat * Math.sin(lon),
  };
}

/**
 * Latitude/longitude of a direction. A zero direction reads as the pole.
 */
export function directionToGeodetic(direction: { x: number; y: number; z: number }): {
  latitudeDeg: number;
  longitudeDeg: number;
} {
  const length = Math.hypot(direction.x, direction.y, direction.z);
  if (length < 1e-12) return { latitudeDeg: 90, longitudeDeg: 0 };
  const x = direction.x / length;
  const y = direction.y / length;
  const z = direction.z / length;
  const latitudeDeg = Math.asin(Math.max(-1, Math.min(1, y))) * RAD;
  const longitudeDeg = Math.abs(x) < 1e-12 && Math.abs(z) < 1e-12 ? 0 : Math.atan2(z, x) * RAD;
  return { latitudeDeg, longitudeDeg: wrapLongitude(longitudeDeg) };
}

/**
 * Local position of a coordinate.
 *
 * `altitudeM` is radial height over the base sphere. The returned local `y` is
 * the same kind of number a terrain sample uses: 0 at the pole's tangent plane,
 * negative away from it by the curvature drop, plus the altitude.
 */
export function geodeticToLocal(coordinate: GeodeticCoordinate, radiusM: number): LocalPoint {
  const radius = Math.max(0, radiusM);
  const direction = geodeticToDirection(coordinate.latitudeDeg, coordinate.longitudeDeg);
  const height = radius + coordinate.altitudeM;
  return {
    x: direction.x * height,
    y: direction.y * height - radius,
    z: direction.z * height,
  };
}

/**
 * Geographic coordinate of a local point. Altitude is radial height over the
 * base sphere, so it is zero everywhere on the reference sphere, including the
 * curved play area away from the pole.
 */
export function localToGeodetic(point: LocalPoint, radiusM: number): GeodeticCoordinate {
  const radius = Math.max(1, radiusM);
  const direction = directionToGeodetic({
    x: point.x,
    y: point.y + radius,
    z: point.z,
  });
  const altitudeM = Math.hypot(point.x, point.y + radius, point.z) - radius;
  return {
    latitudeDeg: direction.latitudeDeg,
    longitudeDeg: direction.longitudeDeg,
    altitudeM,
  };
}

/** How far below the tangent plane the base sphere sits at a plan distance. */
export function planetCurveDrop(radiusM: number, distanceM: number): number {
  const radius = Math.max(0, radiusM);
  if (!(radius > 0)) return 0;
  const distance = Math.min(radius, Math.max(0, distanceM));
  return radius - Math.sqrt(Math.max(0, radius * radius - distance * distance));
}

/** Surface-local `y` (curvature only) at a plan point. */
export function localSurfaceY(radiusM: number, x: number, z: number): number {
  return -planetCurveDrop(radiusM, Math.hypot(x, z));
}

/** Great-circle distance in metres between two coordinates on the same sphere. */
export function geodeticDistanceM(
  a: Pick<GeodeticCoordinate, 'latitudeDeg' | 'longitudeDeg'>,
  b: Pick<GeodeticCoordinate, 'latitudeDeg' | 'longitudeDeg'>,
  radiusM: number,
): number {
  const lat1 = a.latitudeDeg * DEG;
  const lat2 = b.latitudeDeg * DEG;
  const dLat = lat2 - lat1;
  const dLon = wrapLongitude(b.longitudeDeg - a.longitudeDeg) * DEG;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * Math.max(0, radiusM) * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** `12.3456° N, 45.6789° E · 14 m` with a configurable precision. */
export function formatGeodetic(coordinate: GeodeticCoordinate, decimals = 4): string {
  const precision = Math.max(0, Math.min(8, Math.round(decimals)));
  const latHemisphere = coordinate.latitudeDeg >= 0 ? 'N' : 'S';
  const lonHemisphere = coordinate.longitudeDeg >= 0 ? 'E' : 'W';
  const lat = Math.abs(coordinate.latitudeDeg).toFixed(precision);
  const lon = Math.abs(coordinate.longitudeDeg).toFixed(precision);
  const altitude = Math.round(coordinate.altitudeM);
  return `${lat}° ${latHemisphere}, ${lon}° ${lonHemisphere} · ${altitude} m`;
}

/**
 * A compact coordinate for a HUD chip: four decimals is about 11 m at the
 * play-area latitude, which is finer than the player can walk between frames.
 */
export function formatGeodeticShort(coordinate: GeodeticCoordinate): string {
  return formatGeodetic(coordinate, 4);
}

export interface ParsedCoordinate {
  latitudeDeg: number;
  longitudeDeg: number;
}

function parseAngle(raw: string): number | null {
  const text = raw.trim();
  if (!text) return null;
  const hemisphere = /([NSEW])$/i.exec(text)?.[1]?.toUpperCase() ?? null;
  const body = hemisphere ? text.slice(0, -1).trim() : text;
  const dms =
    /^([+-]?\d+(?:\.\d+)?)\s*[°d]\s*(?:(\d+(?:\.\d+)?)\s*['′m]\s*)?(?:(\d+(?:\.\d+)?)\s*["″s]\s*)?$/i.exec(
      body,
    );
  let value: number;
  if (dms) {
    const degrees = Number(dms[1]);
    const minutes = dms[2] === undefined ? 0 : Number(dms[2]);
    const seconds = dms[3] === undefined ? 0 : Number(dms[3]);
    if (
      !Number.isFinite(degrees) ||
      !Number.isFinite(minutes) ||
      !Number.isFinite(seconds) ||
      minutes < 0 ||
      minutes >= 60 ||
      seconds < 0 ||
      seconds >= 60
    ) {
      return null;
    }
    const sign = degrees < 0 ? -1 : 1;
    value = sign * (Math.abs(degrees) + minutes / 60 + seconds / 3600);
  } else {
    const decimal = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.exec(body);
    if (!decimal) return null;
    value = Number(body);
  }
  if (!Number.isFinite(value)) return null;
  if (hemisphere === 'S' || hemisphere === 'W') value = -Math.abs(value);
  if (hemisphere === 'N' || hemisphere === 'E') value = Math.abs(value);
  return value;
}

/** Parse one latitude field, with or without a hemisphere letter. */
export function parseLatitude(raw: string): number | null {
  const value = parseAngle(raw);
  if (value === null || !isLatitudeInRange(value)) return null;
  return value;
}

/** Parse one longitude field, with or without a hemisphere letter. */
export function parseLongitude(raw: string): number | null {
  const value = parseAngle(raw);
  if (value === null || !isLongitudeInRange(value)) return null;
  return value;
}

/**
 * Parse a pair in the order the form presents: latitude first, longitude
 * second. Comma, semicolon and whitespace separators are accepted. A
 * hemisphere letter on the longitude is optional.
 */
export function parseGeodeticPair(raw: string): ParsedCoordinate | null {
  const text = raw.trim();
  if (!text) return null;
  const parts = text.includes(',')
    ? text.split(',')
    : text.includes(';')
      ? text.split(';')
      : text.split(/\s+/);
  if (parts.length < 2) return null;
  // DMS can contain spaces. If the simple split produced more than two pieces,
  // use a regex that treats a sign/hemisphere as the end of each angle.
  const latitude = parseLatitude(parts[0] as string);
  const longitude = parseLongitude(parts.slice(1).join(' '));
  if (latitude === null || longitude === null) return null;
  return { latitudeDeg: latitude, longitudeDeg: longitude };
}
