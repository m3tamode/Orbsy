/*
 * Orbsy 18 — Toxic Nebula. Original shader, MIT.
 * Not a "use client" module, so server components can read the variant as data.
 * The shader lives in a template literal: its comments must not contain backticks.
 */
import { ShaderOrb, type OrbVariant, type ShaderOrbProps } from "@/components/ui/orbkit-core";
import { ORBSY_GLSL } from "@/components/ui/orbsy-glsl";

/*
  A fluoro-green take on orbsy-08 Nebula, rendered entirely through a recursive
  block grid. The same two-level domain-warped 3D fbm gas fills the ball, with
  white-hot knots where the warp folds the gas onto itself. The sphere is cut
  into the six faces of a cube (orbsyCubeUV), and each face into a quadtree:
  a cell splits in four while a cheap probe of the gas says the energy is
  changing there (mid energy, the edges of clouds) or a travelling wave of
  refinement passes over it, so calm dark gas and hot cores sit in big blocks
  and the fronts between them break into fine ones. The grid lives on the
  sphere, so blocks wrap the ball and turn with it. The gas is sampled once per
  block at the cell centre and ordered-dithered, every block gets a 1px seam,
  and a smooth low-octave field carries the bloom across the seams. Past the
  rim, screen-space blocks of the same gas escape along the bleed.
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

// Inverse of orbsyCubeUV: face-local coords in [-1,1] and face id to a direction.
vec3 toxicCubeDir(vec2 f, float face) {
  vec3 d = vec3(f.x, f.y, -1.0);
  if (face < 0.5) d = vec3(1.0, f.y, f.x);
  else if (face < 1.5) d = vec3(-1.0, f.y, -f.x);
  else if (face < 2.5) d = vec3(f.x, 1.0, f.y);
  else if (face < 3.5) d = vec3(f.x, -1.0, -f.y);
  else if (face < 4.5) d = vec3(-f.x, f.y, 1.0);
  return normalize(d);
}

// View normal under a screen point, turned into the ball's own frame.
vec3 toxicObj(vec2 uv, float R, float px) {
  vec3 n = orbsySphere(orbRimUV(uv, R), R, px).xyz;
  n.yz = orbsyRot(0.35) * n.yz;
  n.xz = orbsyRot(uP_spin) * n.xz;
  return n;
}

// Cell index of a direction on a grid of N cells per cube face (face in z).
vec3 toxicCell(vec3 n, float N) {
  vec3 cu = orbsyCubeUV(n);
  return vec3(floor((cu.xy * 0.5 + 0.5) * N), cu.z);
}

void main() {
  vec2 uv0 = orbUV();
  float px = orbsyPx();
  float R = uP_radius * (1.0 + 0.04 * uOutput);
  float t = uP_speed;
  float r0 = length(uv0);
  vec2 fc = orbFragCoord(uv0);
  float sz = orbsySphere(orbRimUV(uv0, R), R, px).z;

  /*
    Quadtree on the cube faces. Start at uP_grid cells per face and split while
    the probe asks for detail. The probe is one octave of the gas at the cell
    centre: its mid band marks where the energy is changing. A slow wave of
    refinement travels round the ball on its own clock, and a stepped hash per
    cell keeps the boundary ragged.
  */
  vec3 n = toxicObj(uv0, R, px);
  vec3 cu = orbsyCubeUV(n);
  vec2 g = cu.xy * 0.5 + 0.5;
  float N = max(floor(uP_grid), 1.0);
  float lvl = 0.0;
  float reseed = floor(uP_sweep * 0.7);
  for (int i = 0; i < 5; i++) {
    vec2 ci = floor(g * N);
    vec3 d = toxicCubeDir((ci + 0.5) / N * 2.0 - 1.0, cu.z) * uP_scale;
    float pr = noise3(d + vec3(0.0, 0.0, t * 0.8)) * 0.65 + noise3(d * 2.1 + vec3(3.1, 0.0, t)) * 0.35;
    float mid = 1.0 - abs(2.0 * smoothstep(0.3, 0.7, pr) - 1.0);
    float wave = smoothstep(0.55, 1.0, sin(dot(d, vec3(0.62, 0.7, 0.35)) * 5.0 / uP_scale - uP_sweep * 2.0));
    float h = hash31(vec3(ci, cu.z * 17.0 + N * 3.0 + reseed));
    float sc = mid * uP_refine + wave * uP_wave + (h - 0.5) * 0.45 + 0.25 * uOutput;
    // never split below about 3px, which at the limb keeps slivers from
    // turning into a fringe of seams
    float nextPx = 0.785 / N * R / px * max(sz, 0.08);
    if (sc < 0.14 + 0.16 * float(i) || nextPx < 3.0) break;
    N *= 2.0;
    lvl += 1.0;
  }
  vec2 ci = floor(g * N);
  vec2 fb = fract(g * N);
  vec3 dir = toxicCubeDir((ci + 0.5) / N * 2.0 - 1.0, cu.z);

  // The gas, once per block.
  float qx;
  float lo;
  float f = toxicGas(dir * uP_scale, t, qx, lo);
  float knot = smoothstep(0.35, 0.8, f * qx * 1.6);
  float e = smoothstep(0.26, 0.8, f) * 0.9 + knot * uP_knots;
  // a few fine blocks flash like stars
  float sh = hash31(vec3(ci, cu.z * 31.0 + N));
  e += step(0.975, sh) * step(1.5, lvl) * (0.6 + 0.4 * sin(t * 6.0 + sh * 40.0)) * 0.7;

  // The block's centre seen on screen, so the organic rim takes whole blocks.
  vec3 v = dir;
  v.xz = orbsyRot(-uP_spin) * v.xz;
  v.yz = orbsyRot(-0.35) * v.yz;
  vec2 bc = v.xy / max(length(v.xy), 1e-4) * R * (v.z > 0.0 ? length(v.xy) : 1.0);
  float mask = orbOrganicMask(bc, R, uP_organic, uP_edgeSoft, uP_edgeFlow)
             * orbOrganicMask(uv0, R * 1.01, uP_organic, uP_edgeSoft, uP_edgeFlow);
  // limb shading by the block, and limb blocks drop out at random so the rim
  // crumbles instead of closing into a lit ring
  float vz = max(v.z, 0.0);
  e *= mix(0.2, 1.0, smoothstep(0.0, 0.7, vz));
  mask *= step(hash31(vec3(ci, cu.z * 7.0 + N + reseed)), 0.25 + 0.75 * smoothstep(0.05, 0.45, vz));

  // Ordered dither: pixel-scale inside big blocks, one value per small block.
  float cellPx = 1.5708 / N * R / px * max(sz, 0.2);
  float E = e * uP_bright * (0.85 + 0.45 * uOutput);
  vec2 bq = cellPx > 9.0 ? floor(fc * 0.5) : ci;
  float dq = floor(E * 4.0 + orbsyBayer8(bq)) / 4.0;
  E = mix(E, dq * smoothstep(0.05, 0.16, E), uP_dither);

  // 1px seams: the neighbouring pixels fall in another cell of this level.
  vec3 c0 = vec3(ci, cu.z);
  vec3 c1 = toxicCell(toxicObj(uv0 + vec2(px, 0.0), R, px), N);
  vec3 c2 = toxicCell(toxicObj(uv0 + vec2(0.0, px), R, px), N);
  float seam = (1.0 - step(0.5, length(c1 - c0))) * (1.0 - step(0.5, length(c2 - c0)));
  // small cells get a lighter seam so fine regions read as gas, not as mesh
  float seamD = mix(0.5, 0.88, smoothstep(4.0, 10.0, cellPx));
  E *= (1.0 - seamD * (1.0 - seam)) * (0.86 + 0.24 * fb.y);

  vec3 col = orbsyFluoro(E, uC_deep, uC_base, uC_hot) * smoothstep(0.0, 0.06, E) * mask;

  // Bloom: a smooth low octave of the gas under this pixel, gathered round
  // hot blocks, so light crosses the seams.
  float loP = noise3(n * uP_scale + vec3(t * 0.5));
  float hot = smoothstep(0.55, 0.9, loP) * smoothstep(0.0, 0.5, sz) * (0.25 + knot * 0.8) * mix(0.3, 1.0, smoothstep(0.2, 0.9, e));
  col += (uC_base * hot * 0.42 + uC_hot * knot * 0.16) * uP_bloom * mask;

  // Escaping gas past the rim, in screen-space blocks that grow with distance.
  if (r0 > R * 0.85) {
    float base = max(uP_block, 1.0) * px;
    float big = base * 8.0;
    vec2 bb = floor(uv0 / big);
    float jit = hash31(vec3(bb, floor(t * 1.5)));
    float qq = clamp(smoothstep(R * 0.95, R * 1.3, length((bb + 0.5) * big)) + (jit - 0.5) * 0.5 + 0.2 * uOutput, 0.0, 1.0);
    float bs = base * exp2(1.0 + floor(qq * 2.99));
    vec2 bi = floor(uv0 / bs);
    vec2 ub = (bi + 0.5) * bs;
    vec2 fo2 = fract(uv0 / bs);
    float qo;
    float loo;
    vec3 ep = vec3(ub * 1.6 * uP_scale * 0.55, length(ub) * 3.0 - uP_edgeFlow * 0.5);
    float fo = toxicGas(ep, t, qo, loo);
    float wisp = smoothstep(0.4, 0.72, fo);
    float eo = mix(0.02, 1.2, wisp * wisp) + smoothstep(0.35, 0.8, fo * qo * 1.6) * uP_knots * 0.8;
    // patchy along the rim, and fed by the rim blocks nearby
    float pf = mix(0.12, 1.0, smoothstep(0.38, 0.72, orbEdgeFbm(vec3(ub * 3.2, uP_edgeFlow * 0.45))));
    float feed = smoothstep(0.1, 0.6, e) + 0.35;
    float bl = orbBleed(ub, R, uP_reach, uP_edgeFlow) * uP_bleed * (0.7 + 0.6 * uOutput) * pf * feed;
    float Eo = eo * bl * uP_bright;
    float dqo = floor(Eo * 4.0 + orbsyBayer8(bi)) / 4.0;
    Eo = mix(Eo, dqo * smoothstep(0.05, 0.16, Eo), uP_dither);
    Eo *= step(px * 0.9 / bs, fo2.x) * step(px * 0.9 / bs, fo2.y);
    col += orbsyFluoro(Eo, uC_deep, uC_base, uC_hot) * smoothstep(0.0, 0.06, Eo) * (1.0 - mask);
    col += uC_base * smoothstep(0.45, 0.85, loo) * bl * uP_bloom * 0.25 * (1.0 - mask);
  }

  col = orbsyBloomTone(col, 1.0);
  float a = clamp(max(col.r, max(col.g, col.b)) * 1.2, 0.0, 1.0);
  gl_FragColor = vec4(col, a);
}
`;

export const orbsy18Orb: OrbVariant = {
  key: "orbsy-18",
  label: "Toxic Nebula",
  note: "fluoro nebula rendered through a quadtree of dithered blocks wrapped round the ball, white-hot knots",
  frag: ORBSY18_FRAG,
  params: [
    { key: "speed", label: "Gas flow", min: 0, max: 3, step: 0.01, default: 0.25, integrate: true },
    { key: "spin", label: "Spin rate", min: 0, max: 2, step: 0.01, default: 0.06, integrate: true },
    { key: "radius", label: "Radius", min: 0.3, max: 1, step: 0.01, default: 0.78 },
    { key: "scale", label: "Gas scale", min: 0.5, max: 6, step: 0.05, default: 1.8 },
    { key: "warp", label: "Swirl", min: 0, max: 5, step: 0.05, default: 1.7 },
    { key: "bright", label: "Brightness", min: 0.2, max: 3, step: 0.01, default: 1.1 },
    { key: "knots", label: "Hot knots", min: 0, max: 2, step: 0.01, default: 0.9 },
    { key: "grid", label: "Top blocks per face", min: 1, max: 6, step: 1, default: 4 },
    { key: "refine", label: "Detail split", min: 0, max: 2, step: 0.01, default: 1 },
    { key: "wave", label: "Split wave", min: 0, max: 1.5, step: 0.01, default: 0.4 },
    { key: "sweep", label: "Wave speed", min: 0, max: 3, step: 0.01, default: 0.3, integrate: true },
    { key: "block", label: "Escape block size", min: 1, max: 6, step: 0.1, default: 2 },
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
    // calm gas in big quiet blocks, fine ones only along the cloud fronts
    idle: {
      speed: 0.2, spin: 0.05, scale: 1.8, warp: 1.6, bright: 1.12, knots: 0.8, grid: 4, refine: 1.0,
      wave: 0.3, sweep: 0.25, block: 2, dither: 0.8, bloom: 0.7, organic: 0.035, bleed: 0.9,
      reach: 0.12, edgeFlow: 0.25
    },
    // tighter, faster swirl; waves of fine blocks sweep round the ball
    thinking: {
      speed: 0.7, spin: 0.22, scale: 2.4, warp: 2.7, bright: 1.1, knots: 1.0, grid: 4, refine: 1.3,
      wave: 1.0, sweep: 1.4, block: 2.5, dither: 0.95, bloom: 0.8, organic: 0.05, bleed: 1.2,
      reach: 0.13, edgeFlow: 0.7
    },
    // brightest: big white-hot blocks flare and the gas pours out in blocks
    speaking: {
      speed: 0.9, spin: 0.1, scale: 1.8, warp: 2.0, bright: 1.35, knots: 1.2, grid: 3, refine: 0.9,
      wave: 0.5, sweep: 0.6, block: 2, dither: 0.7, bloom: 1.3, organic: 0.07, bleed: 1.6,
      reach: 0.16, edgeFlow: 1.0
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
