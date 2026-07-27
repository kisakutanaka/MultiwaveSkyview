import * as THREE from "three";

interface ColorStop {
  t: number;
  color: [number, number, number];
}

const STOPS: Record<string, ColorStop[]> = {
  grayscale: [
    { t: 0, color: [0, 0, 0] },
    { t: 1, color: [255, 255, 255] },
  ],
  inferno: [
    { t: 0.0, color: [0, 0, 4] },
    { t: 0.2, color: [40, 11, 84] },
    { t: 0.4, color: [101, 21, 110] },
    { t: 0.6, color: [159, 42, 99] },
    { t: 0.7, color: [212, 72, 66] },
    { t: 0.85, color: [245, 125, 21] },
    { t: 1.0, color: [252, 255, 164] },
  ],
  viridis: [
    { t: 0.0, color: [68, 1, 84] },
    { t: 0.25, color: [59, 82, 139] },
    { t: 0.5, color: [33, 145, 140] },
    { t: 0.75, color: [94, 201, 98] },
    { t: 1.0, color: [253, 231, 37] },
  ],
};

export const COLORMAP_NAMES = Object.keys(STOPS);

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function sampleStops(stops: ColorStop[], t: number): [number, number, number] {
  const first = stops[0]!;
  const last = stops[stops.length - 1]!;
  if (t <= first.t) return first.color;
  if (t >= last.t) return last.color;

  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i]!;
    const b = stops[i + 1]!;
    if (t >= a.t && t <= b.t) {
      const localT = (t - a.t) / (b.t - a.t);
      return [
        Math.round(lerp(a.color[0], b.color[0], localT)),
        Math.round(lerp(a.color[1], b.color[1], localT)),
        Math.round(lerp(a.color[2], b.color[2], localT)),
      ];
    }
  }
  return last.color;
}

const LUT_SIZE = 256;

function createColormapTexture(name: string): THREE.DataTexture {
  const stops = STOPS[name];
  if (!stops) {
    throw new Error(`Unknown colormap: ${name}`);
  }

  const data = new Uint8Array(LUT_SIZE * 4);
  for (let i = 0; i < LUT_SIZE; i++) {
    const t = i / (LUT_SIZE - 1);
    const [r, g, b] = sampleStops(stops, t);
    data[i * 4 + 0] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = 255;
  }

  const texture = new THREE.DataTexture(data, LUT_SIZE, 1, THREE.RGBAFormat);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}

export function createAllColormapTextures(): Record<string, THREE.DataTexture> {
  const result: Record<string, THREE.DataTexture> = {};
  for (const name of COLORMAP_NAMES) {
    result[name] = createColormapTexture(name);
  }
  return result;
}
