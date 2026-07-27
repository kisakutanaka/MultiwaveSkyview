import * as THREE from "three";
import { skyFragmentShader } from "./shaders/sky.frag";
import { skyVertexShader } from "./shaders/sky.vert";

export interface LayerUniformInput {
  texture: THREE.Texture;
  colormap: THREE.Texture;
  kind: "scalar" | "color";
}

function createPlaceholderTexture(): THREE.DataTexture {
  const texture = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, THREE.RGBAFormat);
  texture.needsUpdate = true;
  return texture;
}

export class SkyLayerMaterial extends THREE.ShaderMaterial {
  constructor() {
    const placeholderTexture = createPlaceholderTexture();
    const placeholderColormap = createPlaceholderTexture();

    super({
      glslVersion: THREE.GLSL3,
      vertexShader: skyVertexShader,
      fragmentShader: skyFragmentShader,
      uniforms: {
        uTextureA: { value: placeholderTexture },
        uTextureB: { value: placeholderTexture },
        uColormapA: { value: placeholderColormap },
        uColormapB: { value: placeholderColormap },
        uKindA: { value: 0 },
        uKindB: { value: 0 },
        uBlend: { value: 0 },
      },
    });
  }

  setLayer(slot: "A" | "B", input: LayerUniformInput): void {
    this.uniforms[`uTexture${slot}`]!.value = input.texture;
    this.uniforms[`uColormap${slot}`]!.value = input.colormap;
    this.uniforms[`uKind${slot}`]!.value = input.kind === "color" ? 1 : 0;
  }

  setBlend(value: number): void {
    this.uniforms.uBlend!.value = value;
  }
}
