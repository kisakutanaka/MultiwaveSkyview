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
  fragColor = vec4(mix(colorA, colorB, uBlend), 1.0);
}
`;
