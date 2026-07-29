import * as THREE from "three";

/**
 * Galactic (l, b) -> Three.js world-space unit direction vector, matching
 * exactly how our sky sphere texture is built and displayed. Current
 * (PNG-based) pipeline, re-derived from scratch - a previous version of this
 * derivation assumed the pre-PNG-pivot pipeline (client-side FITS parsing +
 * THREE.DataTexture with flipY=false) and was never updated when the
 * pipeline switched to server-rendered PNGs + plain THREE.Texture, which
 * silently inverted the v<->GLAT relationship (see step 3 below). That stale
 * derivation produced a north/south (Y-axis) sign error that only affected
 * this function - not the base sky sphere rendering, which samples the
 * geometry's own UV directly and has no separate GLAT computation to go
 * stale.
 *
 * 1. allsky_surveys.build_car_wcs (Python) maps pixel column/row -> GLON/GLAT
 *    with CRPIX/CDELT such that, for a pixel's fractional position
 *    t=(px+0.5)/width, s=(py+0.5)/height (0-indexed array row/col):
 *      GLON = 180 - 360*t   (CDELT1 is negative)
 *      GLAT = 180*s - 90    (CDELT2 is positive, so s=0 -> GLAT=-90)
 * 2. convert_allsky_png.py applies `np.flipud` (scalar surveys) /
 *    `Image.FLIP_TOP_BOTTOM` (color surveys) before saving, so PNG row 0
 *    (top of file) = original row height-1 (s=1, GLAT=+90/north). PNG file,
 *    read top-to-bottom: north -> south.
 * 3. textures.ts's createTextureForSurvey builds a plain `THREE.Texture`
 *    (not DataTexture) and never sets `flipY`, so it keeps Three.js's
 *    default flipY=true: the image's top row ends up at texture v=1. So
 *    PNG-top/north -> v=1, PNG-bottom/south -> v=0, i.e. v = (GLAT+90)/180.
 * 4. SphereGeometry (node_modules/three/src/geometries/SphereGeometry.js)
 *    assigns `uv.y = 1 - (iy/heightSegments)` per vertex row and uses
 *    `theta = (iy/heightSegments)*PI` for the vertex position
 *    (y = R*cos(theta)), so iy=0 (sphere apex, y=+R) gets uv.y=1. Combined
 *    with step 3 (uv.y=v=(GLAT+90)/180): iy/heightSegments = 1 - v, so
 *    theta = PI*(1-v) = PI*(90-GLAT)/180.
 *    phi = u*2*PI, x=-R*sin(theta)*cos(phi), z=R*sin(theta)*sin(phi).
 * 5. createSkySphere.ts applies geometry.scale(-1,1,1), flipping x.
 *
 * Combining these gives theta = PI*(90-GLAT)/180, phi = PI*(1 - GLON/180).
 * (sin(theta) is unchanged by the north/south sign fix since
 * sin(PI-x)=sin(x); only the y=cos(theta) component flips.)
 */
export function galacticToWorldDirection(lDeg: number, bDeg: number): THREE.Vector3 {
  let lon = lDeg % 360;
  if (lon > 180) {
    lon -= 360;
  } else if (lon < -180) {
    lon += 360;
  }

  const theta = ((90 - bDeg) / 180) * Math.PI;
  const phi = (1 - lon / 180) * Math.PI;

  const sinTheta = Math.sin(theta);
  return new THREE.Vector3(sinTheta * Math.cos(phi), Math.cos(theta), sinTheta * Math.sin(phi)).normalize();
}
