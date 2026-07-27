const MS_PER_DAY = 86400000;
const UNIX_EPOCH_JD = 2440587.5;

export function julianDate(date: Date): number {
  return date.getTime() / MS_PER_DAY + UNIX_EPOCH_JD;
}

function normalizeDeg(deg: number): number {
  const wrapped = deg % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

/** Greenwich Mean Sidereal Time, in degrees (standard IAU polynomial). */
export function greenwichMeanSiderealTimeDeg(date: Date): number {
  const jd = julianDate(date);
  const t = (jd - 2451545.0) / 36525.0;
  const gmst =
    280.46061837 +
    360.98564736629 * (jd - 2451545.0) +
    0.000387933 * t * t -
    (t * t * t) / 38710000;
  return normalizeDeg(gmst);
}

export function localSiderealTimeDeg(date: Date, longitudeDeg: number): number {
  return normalizeDeg(greenwichMeanSiderealTimeDeg(date) + longitudeDeg);
}
