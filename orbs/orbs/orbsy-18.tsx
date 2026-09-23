/*
 * Orbsy 18 — Toxic Nebula. Original shader, MIT.
 * Not a "use client" module, so server components can read the variant as data.
 * The shader lives in a template literal: its comments must not contain backticks.
 */
import { ShaderOrb, type OrbVariant, type ShaderOrbProps } from "../core/orbkit-core";
import { ORBSY_GLSL } from "./orbsy-glsl";

/*
  A fluoro-green take on orbsy-08 Nebula that dissolves into data at its edge.
  The same two-level domain-warped 3D fbm gas fills the ball, with white-hot
  knots where the warp folds the gas onto itself. Toward the rim, and wherever
  the voice pushes it, the screen is snapped to a quadtree of pixel blocks
  (block size doubling per level, chosen per coarse cell with a hashed jitter so
  the boundary is ragged), the gas is sampled once per block and ordered
  dithered, so the ball crumbles into square data as it escapes. The low
  octave of the gas gives an analytic bloom around the knots.
*/
const ORBSY18_FRAG =
  ORBSY_GLSL +
  `
// fbm3 with its lowest octave split out, for the bloom.
float toxicFbm(vec3 p, out float lo) {
  float v = 0.0;
  float a = 0.5;
  lo = 0.0;
  for (int i = 0; i < 4; i++) {
    float nz = noise3(p);
    v += a * nz;
    if (i == 0) lo = nz;
    p = p * 2.02 + vec3(5.1, 1.3, 7.7);
    a *= 0.5;
  }
  return v;
}

float toxicGas(vec3 p, float t, out float qx, out float lo) {
  vec3 q = vec3(fbm3(p + vec3(0.0, 0.0, t)), fbm3(p + vec3(5.2, 1.3, -t)), 0.0);
  qx = q.x;
  return toxicFbm(p + q * uP_warp * (1.0 + 0.5 * uInput) + vec3(t * 0.5), lo);
}

void main() {
  vec2 uv0 = orbUV();
  float px = orbsyPx();
  float R = uP_radius * (1.0 + 0.04 * uOutput);
  float t = uP_speed;
  float r0 = length(uv0);

  /*
    Quadtree pixel blocks. The level is decided per coarse cell (the largest
    block), from its distance to the centre, a hashed jitter and a slow
    screen-space energy wash, so every smaller block nests inside one choice.
  */
  float base = max(uP_block, 1.0) * px;
  float big = base * 8.0;
  vec2 cc = (floor(uv0 / big) + 0.5) * big;
  float jit = hash31(vec3(floor(uv0 / big), floor(t * 1.5)));
  float wash = noise3(vec3(cc * 2.5, t * 0.4 + 11.0));
  float q = smoothstep(uP_start * R, R * 1.35, length(cc)) * uP_dissolve
          + (jit - 0.5) * 0.3 + (wash - 0.5) * 0.35 * uP_dissolve + 0.25 * uOutput;
  q = clamp(q, 0.0, 1.0);
  float level = floor(q * 3.99);
  float bs = base * exp2(level);
  vec2 bi = floor(uv0 / bs);
  vec2 uv = level > 0.0 ? (bi + 0.5) * bs : uv0;
  vec2 fb = fract(uv0 / bs);
  float r = length(uv);

  float mask = orbOrganicMask(uv, R, uP_organic, uP_edgeSoft, uP_edgeFlow);
  vec4 s = orbsySphere(orbRimUV(uv, R), R, px);
  vec3 n = s.xyz;
  n.xz = orbsyRot(uP_spin) * n.xz;
  float qx;
  float lo;
  float f = toxicGas(n * uP_scale, t, qx, lo);

  float knot = smoothstep(0.35, 0.8, f * qx * 1.6);
  float e = smoothstep(0.22, 0.8, f) * 0.85 + knot * uP_knots;
  vec3 sp = n * 22.0;
  vec3 sf = fract(sp) - 0.5;
  float sh = hash31(floor(sp));
  e += step(0.94, sh) * exp(-dot(sf, sf) * 60.0) * (0.6 + 0.4 * sin(t * 6.0 + sh * 40.0)) * 0.8;
  e *= mix(0.45, 1.0, s.z);
  e += pow(1.0 - s.z, 4.0) * 0.4;

  // Escaping gas, sampled in screen space so it never streaks into rays.
  float qo;
  float loo;
  vec3 ep = vec3(uv * 1.6 * uP_scale * 0.55, r * 3.0 - uP_edgeFlow * 0.5);
  float fo = toxicGas(ep, t, qo, loo);
  float wisp = smoothstep(0.4, 0.72, fo);
  float eo = mix(0.02, 1.2, wisp * wisp) + smoothstep(0.35, 0.8, fo * qo * 1.6) * uP_knots * 0.8;
  e = mix(e, eo * 0.9, smoothstep(R * 0.97, R * 1.06, r));
  float bl = orbBleed(uv, R, uP_reach, uP_edgeFlow) * uP_bleed * (0.7 + 0.6 * uOutput);
  float escape = eo * bl * (1.0 - mask);

  float E = (e * mask + escape) * uP_bright * (0.85 + 0.45 * uOutput);

  // Ordered dither and a 1px seam inside the blocks.
  if (level > 0.0) {
    float lv = 4.0;
    float dq = floor(E * lv + orbsyBayer8(bi)) / lv;
    // faint gas drops out rather than dithering up into stray blocks
    E = mix(E, dq * smoothstep(0.05, 0.16, E), uP_dither);
    float seam = step(px * 0.9 / bs, fb.x) * step(px * 0.9 / bs, fb.y);
    E *= mix(1.0, seam * (0.85 + 0.25 * (1.0 - fb.y)), step(1.5, level));
  }

  vec3 col = orbsyFluoro(E, uC_deep, uC_base, uC_hot) * smoothstep(0.0, 0.06, E);
  // Bloom: the low octave of the warped gas, gathered round the knots.
  float bloomE = smoothstep(0.45, 0.85, lo) * (0.4 + knot) * mix(mask, bl, 1.0 - mask);
  col += uC_base * bloomE * uP_bloom * 0.45 + uC_hot * knot * mask * uP_bloom * 0.2;
  float halo = exp(-max(r0 - R, 0.0) / 0.06) * (1.0 - mask) * uP_bloom * 0.2;
  col += uC_base * halo;

  col = orbsyBloomTone(col, 1.0);
  float a = clamp(max(col.r, max(col.g, col.b)) * 1.2, 0.0, 1.0);
  gl_FragColor = vec4(col, a);
}
`;

export const orbsy18Orb: OrbVariant = {
  key: "orbsy-18",
  label: "Toxic Nebula",
  note: "fluoro nebula with white-hot knots that crumbles into dithered pixel blocks at its edge",
  frag: ORBSY18_FRAG,
  params: [
    { key: "speed", label: "Gas flow", min: 0, max: 3, step: 0.01, default: 0.25, integrate: true },
    { key: "spin", label: "Spin rate", min: 0, max: 2, step: 0.01, default: 0.06, integrate: true },
    { key: "radius", label: "Radius", min: 0.3, max: 1, step: 0.01, default: 0.78 },
    { key: "scale", label: "Gas scale", min: 0.5, max: 6, step: 0.05, default: 1.8 },
    { key: "warp", label: "Swirl", min: 0, max: 5, step: 0.05, default: 1.7 },
    { key: "bright", label: "Brightness", min: 0.2, max: 3, step: 0.01, default: 1.1 },
    { key: "knots", label: "Hot knots", min: 0, max: 2, step: 0.01, default: 0.9 },
    { key: "block", label: "Block size", min: 1, max: 6, step: 0.1, default: 2 },
    { key: "start", label: "Dissolve start", min: 0, max: 1.2, step: 0.01, default: 0.6 },
    { key: "dissolve", label: "Dissolve", min: 0, max: 2, step: 0.01, default: 1 },
    { key: "dither", label: "Dither", min: 0, max: 1, step: 0.01, default: 0.8 },
    { key: "bloom", label: "Bloom", min: 0, max: 2, step: 0.01, default: 0.8 },
    { key: "organic", label: "Rim wander", min: 0, max: 0.15, step: 0.005, default: 0.04 },
    { key: "edgeSoft", label: "Rim feather", min: 0, max: 0.2, step: 0.005, default: 0.04 },
    { key: "bleed", label: "Energy bleed", min: 0, max: 3, step: 0.01, default: 1.0 },
    { key: "reach", label: "Bleed reach", min: 0.02, max: 0.5, step: 0.005, default: 0.14 },
    { key: "edgeFlow", label: "Edge flow", min: 0, max: 3, step: 0.01, default: 0.3, integrate: true }
  ],
  colors: [
    { key: "deep", label: "Deep", default: "#010d04" },
    { key: "base", label: "Fluoro", default: "#39ff14" },
    { key: "hot", label: "Hot", default: "#d6ff5c" }
  ],
  statePresets: {
    // calm gas, only the outer rim crumbles
    idle: {
      speed: 0.2, spin: 0.05, scale: 1.8, warp: 1.6, bright: 1.0, knots: 0.8, block: 2, start: 0.7,
      dissolve: 0.9, dither: 0.8, bloom: 0.7, organic: 0.035, bleed: 0.9, reach: 0.12, edgeFlow: 0.25
    },
    // tighter, faster swirl; the dissolve eats deep into the ball
    thinking: {
      speed: 0.7, spin: 0.22, scale: 2.4, warp: 2.7, bright: 1.1, knots: 1.0, block: 2.5, start: 0.25,
      dissolve: 1.5, dither: 0.95, bloom: 0.8, organic: 0.05, bleed: 1.2, reach: 0.13, edgeFlow: 0.7
    },
    // brightest: white-hot knots flare and the gas pours out in blocks
    speaking: {
      speed: 0.9, spin: 0.1, scale: 1.8, warp: 2.0, bright: 1.35, knots: 1.2, block: 2, start: 0.55,
      dissolve: 1.1, dither: 0.7, bloom: 1.3, organic: 0.07, bleed: 1.6, reach: 0.16, edgeFlow: 1.0
    }
  },
  stateColors: {
    idle: { deep: "#010d04", base: "#39ff14", hot: "#d6ff5c" },
    thinking: { deep: "#010f08", base: "#2bff6a", hot: "#b8ffd0" },
    speaking: { deep: "#020f02", base: "#5cff1f", hot: "#eaff7a" }
  }
};

export type Orbsy18Props = Omit<ShaderOrbProps, "variant">;

export function Orbsy18({ size = 280, ...rest }: Orbsy18Props) {
  return <ShaderOrb variant={orbsy18Orb} size={size} {...rest} />;
}

export default Orbsy18;
