/*
 * Shared GLSL for the Orbsy orbs. Appended after orbkit's prelude
 * (ORB_GLSL_HELPERS), so uRes / uTime / uInput / uOutput, noise(), fbm(),
 * hash(), orbUV() and tanh3() are all in scope here.
 *
 * Note for editors: this lives in a template literal, so its comments must not
 * contain backticks.
 */
export const ORBSY_GLSL = `
#define PI 3.14159265359
#define TAU 6.28318530718

mat2 orbsyRot(float a) {
  float c = cos(a);
  float s = sin(a);
  return mat2(c, -s, s, c);
}

// One screen pixel in orbUV units.
float orbsyPx() { return 2.0 / min(uRes.x, uRes.y); }

// Fract-based hash: stays stable for the large inputs integrated clocks produce.
float hash31(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.x + p.y) * p.z);
}

float noise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash31(i), hash31(i + vec3(1.0, 0.0, 0.0)), f.x),
        mix(hash31(i + vec3(0.0, 1.0, 0.0)), hash31(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
    mix(mix(hash31(i + vec3(0.0, 0.0, 1.0)), hash31(i + vec3(1.0, 0.0, 1.0)), f.x),
        mix(hash31(i + vec3(0.0, 1.0, 1.0)), hash31(i + vec3(1.0, 1.0, 1.0)), f.x), f.y),
    f.z
  );
}

// 3D fbm. Sampling on the sphere's own normal avoids the seam a lat/long
// mapping of 2D noise would leave.
float fbm3(vec3 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * noise3(p);
    p = p * 2.02 + vec3(5.1, 1.3, 7.7);
    a *= 0.5;
  }
  return v;
}

// Unit normal of a sphere of radius R seen head-on (xyz) and its antialiased
// coverage (w). Outside the disc the normal is clamped to the limb.
vec4 orbsySphere(vec2 uv, float R, float px) {
  float r = length(uv);
  float cov = 1.0 - smoothstep(R - px, R + px, r);
  float rc = min(r, R * 0.9999);
  vec2 xy = uv * (rc / max(r, 1e-5));
  return vec4(vec3(xy, sqrt(R * R - rc * rc)) / R, cov);
}
`;
