import * as THREE from "three";

export const SKY_SPHERE_RADIUS = 500;

/**
 * SphereGeometry with X scaled to -1, the standard Three.js equirectangular
 * panorama trick: it reverses face winding so the inner surface renders,
 * and mirrors U to match build_car_wcs's negative CDELT1 (see
 * allsky_surveys.py), which was chosen for exactly this convention.
 */
export function createSkySphere(material: THREE.Material): THREE.Mesh {
  const geometry = new THREE.SphereGeometry(SKY_SPHERE_RADIUS, 64, 40);
  geometry.scale(-1, 1, 1);
  return new THREE.Mesh(geometry, material);
}
