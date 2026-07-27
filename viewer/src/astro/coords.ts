const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

function normalizeDeg(deg: number): number {
  const wrapped = deg % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

export interface AltAz {
  altDeg: number;
  azDeg: number; // measured from North, clockwise through East
}

export interface Equatorial {
  raDeg: number;
  decDeg: number;
}

export interface Galactic {
  lDeg: number;
  bDeg: number;
}

/**
 * Topocentric horizontal (Alt/Az) -> equatorial (RA/Dec), given the
 * observer's latitude and local sidereal time.
 * Formulas verified against textbook limiting cases (observer on the
 * equator: the North horizon point has dec=+90, and an object rising
 * due east has dec=0 and H=-90deg).
 */
export function altAzToEquatorial(altAz: AltAz, latDeg: number, lstDeg: number): Equatorial {
  const alt = altAz.altDeg * DEG2RAD;
  const az = altAz.azDeg * DEG2RAD;
  const lat = latDeg * DEG2RAD;

  const sinDec = Math.sin(alt) * Math.sin(lat) + Math.cos(alt) * Math.cos(lat) * Math.cos(az);
  const dec = Math.asin(Math.max(-1, Math.min(1, sinDec)));

  const sinH = (-Math.sin(az) * Math.cos(alt)) / Math.cos(dec);
  const cosH = (Math.sin(alt) - Math.sin(lat) * Math.sin(dec)) / (Math.cos(lat) * Math.cos(dec));
  const hourAngleDeg = Math.atan2(sinH, cosH) * RAD2DEG;

  return {
    raDeg: normalizeDeg(lstDeg - hourAngleDeg),
    decDeg: dec * RAD2DEG,
  };
}

// IAU 1958 galactic pole definition, J2000 coordinates.
const RA_NGP_DEG = 192.85948;
const DEC_NGP_DEG = 27.12825;
const L_NCP_DEG = 122.93192;

/**
 * Equatorial (RA/Dec, J2000) -> Galactic (l, b) using the fixed IAU 1958
 * pole rotation. No precession/nutation correction: adequate for a visual
 * display, not for precision pointing.
 */
export function equatorialToGalactic(equatorial: Equatorial): Galactic {
  const ra = equatorial.raDeg * DEG2RAD;
  const dec = equatorial.decDeg * DEG2RAD;
  const raNgp = RA_NGP_DEG * DEG2RAD;
  const decNgp = DEC_NGP_DEG * DEG2RAD;

  const sinB = Math.sin(dec) * Math.sin(decNgp) + Math.cos(dec) * Math.cos(decNgp) * Math.cos(ra - raNgp);
  const b = Math.asin(Math.max(-1, Math.min(1, sinB)));

  const y = Math.cos(dec) * Math.sin(ra - raNgp);
  const x = Math.sin(dec) * Math.cos(decNgp) - Math.cos(dec) * Math.sin(decNgp) * Math.cos(ra - raNgp);
  const l = L_NCP_DEG - Math.atan2(y, x) * RAD2DEG;

  return {
    lDeg: normalizeDeg(l),
    bDeg: b * RAD2DEG,
  };
}
