export const skyFragmentShader = /* glsl */ `
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uTextureA;
uniform sampler2D uTextureB;
uniform sampler2D uColormapA;
uniform sampler2D uColormapB;

// 0 = scalar (pre-stretched gray value, colormap LUT applied),
// 1 = color (pre-rendered RGB, sampled as-is)
uniform int uKindA;
uniform int uKindB;

uniform float uBlend;

vec3 sampleLayer(sampler2D tex, sampler2D colormap, int kind) {
  vec4 texel = texture(tex, vUv);
  if (kind == 1) {
    return texel.rgb;
  }
  return texture(colormap, vec2(texel.r, 0.5)).rgb;
}

void main() {
  vec3 colorA = sampleLayer(uTextureA, uColormapA, uKindA);
  vec3 colorB = sampleLayer(uTextureB, uColormapB, uKindB);

  // uBlend=0 -> A only, 0.5 -> both at full opacity, 1 -> B only:
  // each layer's opacity holds at 1.0 across its own half of the slider
  // and only ramps down crossing into the other half.
  float alphaA = clamp(1.0 - max(0.0, (uBlend - 0.5) * 2.0), 0.0, 1.0);
  float alphaB = clamp(min(1.0, uBlend * 2.0), 0.0, 1.0);

  // Screen blend (not a linear mix): both layers are mostly-black sky data
  // with bright features, so 1-(1-a)(1-b) lets bright spots from either
  // layer show through without one layer just dimming the other.
  vec3 screen = vec3(1.0) - (vec3(1.0) - alphaA * colorA) * (vec3(1.0) - alphaB * colorB);
  fragColor = vec4(screen, 1.0);
}
`;
