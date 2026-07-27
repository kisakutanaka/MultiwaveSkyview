import * as THREE from "three";
import type { SurveyData } from "../types";

export function createTextureForSurvey(survey: SurveyData): THREE.Texture {
  const texture = new THREE.Texture(survey.image);
  // Custom shader samples raw pixel values directly; the PNGs are already
  // tone-mapped by convert_allsky_png.py, so no color-space decode is wanted.
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}
