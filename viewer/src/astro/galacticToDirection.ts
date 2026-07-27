import * as THREE from "three";

/**
 * Galactic (l, b) -> Three.js world-space unit direction vector, matching
 * exactly how our sky sphere texture is built and displayed:
 *
 * 1. allsky_surveys.build_car_wcs (Python) maps pixel column/row -> GLON/GLAT
 *    with CRPIX/CDELT such that, for a pixel's fractional position
 *    t=(px+0.5)/width, s=(py+0.5)/height:
 *      GLON = 180 - 360*t   (CDELT1 is negative)
 *      GLAT = 180*s - 90
 * 2. textures.ts's flipRowsFloat32 reverses row order before upload, and
 *    THREE.DataTexture defaults to flipY=false (no additional flip at
 *    upload), so the texture's v=0 corresponds to the ORIGINAL FITS row
 *    py=height-1, i.e. s_tex = 1 - s.
 * 3. SphereGeometry stores UV.y = 1 - (iy/heightSegments) and its vertex
 *    formula (read from node_modules/three/src/geometries/SphereGeometry.js)
 *    is theta = v_param*PI, phi = u*2*PI,
 *    x=-R*sin(theta)*cos(phi), y=R*cos(theta), z=R*sin(theta)*sin(phi).
 * 4. createSkySphere.ts applies geometry.scale(-1,1,1), flipping x.
 *
 * Combining these gives theta = PI*(GLAT+90)/180, phi = PI*(1 - GLON/180).
 *
 * This chain was derived analytically, not read off a screenshot — if the
 * rendered sky ends up north/south-flipped relative to the real sky, negate
 * `GLAT` right where it's read in here first.
 */
export function galacticToWorldDirection(lDeg: number, bDeg: number): THREE.Vector3 {
  let lon = lDeg % 360;
  if (lon > 180) {
    lon -= 360;
  } else if (lon < -180) {
    lon += 360;
  }

  const theta = ((bDeg + 90) / 180) * Math.PI;
  const phi = (1 - lon / 180) * Math.PI;

  const sinTheta = Math.sin(theta);
  return new THREE.Vector3(sinTheta * Math.cos(phi), Math.cos(theta), sinTheta * Math.sin(phi)).normalize();
}
