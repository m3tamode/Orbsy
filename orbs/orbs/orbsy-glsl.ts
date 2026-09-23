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

// ---- Phosphor kit: the fluoro-green set (orbsy-11 to orbsy-18) -------------

// Energy ramp: deep -> base -> hot, then burning to white past 1 so the
// brightest features read as bloomed highlights rather than clipped green.
vec3 orbsyFluoro(float e, vec3 deep, vec3 base, vec3 hot) {
  e = max(e, 0.0);
  vec3 c = mix(deep, base, smoothstep(0.0, 0.55, e));
  c = mix(c, hot, smoothstep(0.45, 0.9, e));
  c = mix(c, vec3(1.0), smoothstep(0.9, 1.5, e) * 0.9);
  return c * (0.35 + 0.65 * min(e, 1.0) + 0.5 * max(e - 1.0, 0.0));
}

// Bloom tone curve for additive light: anything over 1 spills into the other
// channels (green overexposes toward white, like a phosphor), then tanh.
vec3 orbsyBloomTone(vec3 c, float exposure) {
  c *= exposure;
  float over = max(max(c.r, max(c.g, c.b)) - 1.0, 0.0);
  c += vec3(over * 0.6);
  return tanh3(c);
}

// 8x8 ordered (Bayer) threshold in [0,1), built recursively because GLSL ES 1.0
// has no arrays or bitwise ops.
float orbsyBayer2(vec2 a) {
  a = floor(a);
  return fract(dot(a, vec2(0.5, a.y * 0.75)));
}
float orbsyBayer4(vec2 p) {
  return orbsyBayer2(0.5 * p) * 0.25 + orbsyBayer2(p);
}
float orbsyBayer8(vec2 p) {
  return orbsyBayer4(0.5 * p) * 0.25 + orbsyBayer2(p);
}

// One 5x5 ASCII glyph from a bit-packed integer, sampled at p in [-1,1]^2.
float orbsyGlyphBits(float n, vec2 p) {
  p = floor(p * vec2(-4.0, 4.0) + 2.5);
  if (p.x < 0.0 || p.x > 4.0 || p.y < 0.0 || p.y > 4.0) return 0.0;
  float bit = p.x + 5.0 * p.y;
  return mod(floor(n / exp2(bit)), 2.0);
}

// Density ramp  . : * o & 8 @ #  chosen by a 0..1 level.
float orbsyAscii(float level, vec2 p) {
  float n = 4096.0;
  if (level > 0.2) n = 65600.0;
  if (level > 0.3) n = 332772.0;
  if (level > 0.4) n = 15255086.0;
  if (level > 0.5) n = 23385164.0;
  if (level > 0.6) n = 15252014.0;
  if (level > 0.7) n = 13199452.0;
  if (level > 0.8) n = 11512810.0;
  return level < 0.08 ? 0.0 : orbsyGlyphBits(n, p);
}

// Cube-map coordinates of a unit direction: xy in [-1,1] on the dominant
// face, z the face index 0..5. Grids laid out per face wrap the sphere with
// no pole pinch, which is what recursive grids and Mondrian splits need.
vec3 orbsyCubeUV(vec3 n) {
  vec3 a = abs(n);
  if (a.x >= a.y && a.x >= a.z) return vec3(n.zy / a.x * vec2(sign(n.x), 1.0), n.x > 0.0 ? 0.0 : 1.0);
  if (a.y >= a.z) return vec3(n.xz / a.y * vec2(1.0, sign(n.y)), n.y > 0.0 ? 2.0 : 3.0);
  return vec3(n.xy / a.z * vec2(-sign(n.z), 1.0), n.z > 0.0 ? 4.0 : 5.0);
}

// CRT pieces. Scanlines at a fixed pixel pitch, an aperture-grille phosphor
// mask, barrel curvature for uv, and a slow bright roll bar (t is a clock).
float orbsyScanline(vec2 fragCoord, float pitch, float depth) {
  float s = 0.5 + 0.5 * cos(6.2831853 * fragCoord.y / max(pitch, 1.0));
  return 1.0 - depth * (1.0 - s);
}
vec3 orbsyPhosphorMask(vec2 fragCoord, float amount) {
  float k = mod(floor(fragCoord.x), 3.0);
  vec3 m = vec3(k == 0.0 ? 1.0 : 0.55, k == 1.0 ? 1.0 : 0.55, k == 2.0 ? 1.0 : 0.55);
  return mix(vec3(1.0), m * 1.25, amount);
}
vec2 orbsyBarrel(vec2 uv, float k) {
  return uv * (1.0 + k * dot(uv, uv));
}
float orbsyRollBar(vec2 uv, float t) {
  float y = fract(uv.y * 0.35 - t * 0.12);
  return smoothstep(0.0, 0.08, y) * smoothstep(0.22, 0.08, y);
}
`;
