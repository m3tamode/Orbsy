/*
 * Orbsy 21 — Mosaic Green. MIT. Derived from Orbkit's SHDR-29 (Mosaic,
 * original Orbkit work, MIT), recoloured and relit for the fluoro-green set.
 * Not a "use client" module, so server components can read the variant as data.
 * The shader lives in a template literal: its comments must not contain backticks.
 */
import { ShaderOrb, type OrbVariant, type ShaderOrbProps } from "@/components/ui/orbkit-core";
import { ORBSY_GLSL } from "@/components/ui/orbsy-glsl";

/*
  SHDR-29's LED tile wall, lit fluoro green.

  The structure is SHDR-29's: a resolution-relative grid of bevelled tiles,
  every one faintly present even when dark, lit by a domain-warped fbm blob
  field sampled once per tile through the stereographic wrap of a rotating
  dome. Each state moves on its own integrated clock (drift, churn, shuffle,
  pulse), and a per-tile hash promotes a reshuffling scatter of lit tiles.

  What the green set adds:
  - Lit tiles run through the fluoro energy ramp, and the cores of the
    brightest blobs push past it so whole patches of tiles burn white-hot.
  - The confetti tiles become white-hot, mint and lime accents.
  - Tile bevels glow: lit tiles light their own bevel ring (brighter on the
    key-light side), unlit tiles keep a faint green bevel on a dark wall.
  - Bloom: a per-fragment, low-octave copy of the blob field glows across
    tiles and frames where the wall is bright.
  - An organic silhouette cut on the tile grid, and an energy leak past the
    rim as sparse lit tiles plus haze, both gated by a screen-space patch
    field and by the brightness at the rim, so there is no uniform ring.
  The wall is hardware, so alpha stays coverage inside the mask (SHDR-29's
  semantics) and the brightest channel outside it (premultiplied either way).
*/
const ORBSY21_FRAG =
  ORBSY_GLSL +
  `
// Three-octave fbm: the low-frequency body of fbm(), for the bloom copy.
float mgcFbm3(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 3; i++) {
    v += a * noise(p);
    p = p * 2.03 + vec2(11.7, 7.3);
    a *= 0.5;
  }
  return v;
}

// Rotating dome, stereographic projection (SHDR-29's wrap).
vec2 mgcWrap(vec2 uv, float cr, float sr) {
  float z = sqrt(max(1.0 - dot(uv, uv), 0.0));
  vec3 sp = vec3(uv.x * cr - z * sr, uv.y, uv.x * sr + z * cr);
  return sp.xy / (abs(sp.z) + 1.2) * uP_scale * 3.0;
}

void main() {
  float coverNow = uP_coverage + 0.07 * uInput;
  float gainNow = uP_gain * (0.85 + 0.5 * uOutput);

  // resolution-relative tile grid
  float cellPx = max(min(uRes.x, uRes.y) / max(uP_cells, 8.0), 4.0);
  vec2 cellIdx = floor(gl_FragCoord.xy / cellPx);
  vec2 cellCentre = (cellIdx + 0.5) * cellPx;
  vec2 g = fract(gl_FragCoord.xy / cellPx);

  vec2 suv = (2.0 * cellCentre - uRes) / min(uRes.x, uRes.y);
  float R = uP_radius;

  // organic silhouette, cut on the tile grid like the wall itself
  float mask = orbOrganicMask(suv, R, uP_organic, uP_edgeSoft, uP_edgeFlow);
  vec2 uv = orbRimUV(suv, R) / R;
  float z = sqrt(max(1.0 - dot(uv, uv), 0.0));
  vec3 n = vec3(uv, z);

  float cr = cos(uP_spin);
  float sr = sin(uP_spin);
  vec2 p2 = mgcWrap(uv, cr, sr);

  // per-state motion clocks
  float driftT = uP_drift;
  float churnT = uP_churn;
  float shuffleT = uP_shuffle;
  vec2 f1 = vec2(driftT * 0.5, -driftT * 0.35);
  vec2 f2 = vec2(-churnT * 0.4, churnT * 0.6);

  // fluid domain warp, then the blob field
  vec2 warp = vec2(fbm(p2 * 0.9 + f2), fbm(p2 * 0.9 + f2.yx + 13.7)) - 0.5;
  float field = fbm(p2 + f1 + warp * uP_swirl * 2.4);

  vec3 L = normalize(vec3(-0.45, 0.55, 0.7));
  float lambert = clamp(dot(n, L), 0.0, 1.0);
  float ring = uP_pulse * 0.3 * sin(length(uv) * 5.0 - driftT * 3.2);
  float drive = field + 0.25 * uP_light * lambert + ring;
  float lum = smoothstep(1.0 - coverNow, 1.14 - coverNow, drive) * gainNow;
  // blob cores: how far past the lit threshold this tile sits
  float core = smoothstep(1.12 - coverNow, 1.12 - coverNow + uP_core, drive);

  // the tile: bevelled face inside a frame, LED hot-spot under a diffuser
  vec2 sg = g - 0.5;
  vec2 d2 = abs(sg);
  float d = max(d2.x, d2.y);
  float face = 1.0 - smoothstep(0.26, 0.36, d);
  float tile = 1.0 - smoothstep(0.42, 0.48, d);
  float hotSpot = 1.0 - smoothstep(0.0, 0.34, length(d2));
  float bevel = smoothstep(0.25, 0.34, d) * (1.0 - smoothstep(0.37, 0.45, d));
  // the key-light side of the bevel catches more
  float side = 0.55 + 0.45 * clamp(dot(sg / max(d, 1e-3), vec2(-0.6, 0.6)), -1.0, 1.0);

  /*
    Accents: a per-tile hash cycles against the shuffle clock, and the top
    uP_confetti slice is promoted. A second hash picks white-hot, mint or
    lime for it.
  */
  float h1 = hash(cellIdx * 1.618 + 7.3);
  float h2 = hash(cellIdx * 2.113 + 41.7);
  float cyc = fract(h1 + shuffleT * 0.06);
  float promoted = step(1.0 - uP_confetti, cyc) * step(0.02, lum);

  float shape = face * 1.05 + hotSpot * 0.5;
  float E = lum * shape * (0.45 + 0.65 * core) * uP_burn;
  vec3 onCol = orbsyFluoro(E, uC_deep, uC_base, uC_hot) * step(0.001, E);
  vec3 accent = orbsyFluoro(1.15 + 0.5 * core, uC_deep, uC_base, uC_hot) * shape * min(lum, 1.3);
  if (h2 > 0.42) accent = uC_mint * shape * lum * 1.25;
  if (h2 > 0.74) accent = uC_hot * shape * lum * 1.3;
  onCol = mix(onCol, accent, promoted);

  // dark wall with a faint green bevel; lit tiles light their own bevel
  vec3 col = uC_wall * tile + uC_base * bevel * side * 0.05;
  col += onCol;
  float bevE = bevel * side * lum * uP_bevel;
  col += (uC_base * 0.8 + uC_hot * 0.5 * core) * bevE * 1.2;

  /*
    Bloom: the blob field per fragment at low octaves, glowing across tiles
    and frames where the wall is bright.
  */
  vec2 fuv = orbUV();
  vec2 fu = orbRimUV(fuv, R) / R;
  float fz = sqrt(max(1.0 - dot(fu, fu), 0.0));
  vec2 fp2 = mgcWrap(fu, cr, sr);
  vec2 fw = vec2(mgcFbm3(fp2 * 0.9 + f2), mgcFbm3(fp2 * 0.9 + f2.yx + 13.7)) - 0.44;
  float fdrive = mgcFbm3(fp2 + f1 + fw * uP_swirl * 2.4) + 0.045
    + 0.25 * uP_light * clamp(dot(vec3(fu, fz), L), 0.0, 1.0)
    + uP_pulse * 0.3 * sin(length(fu) * 5.0 - driftT * 3.2);
  float glowL = smoothstep(1.0 - coverNow, 1.3 - coverNow, fdrive) * min(gainNow, 1.6);
  col += (uC_base * 0.7 + uC_hot * 0.25 * glowL) * glowL * glowL * uP_bloom * 0.55;

  col = pow(max(col, 0.0), vec3(uP_contrast));

  /*
    Energy leaking off the wall: sparse tiles past the rim light up along
    the bleed, over a faint haze. Both are gated by a screen-space patch
    field and by the brightness at the rim, so the leak clusters beside lit
    blobs instead of ringing the ball.
  */
  float patchF = mix(0.12, 1.0, smoothstep(0.38, 0.72, orbEdgeFbm(vec3(suv * 3.2, uP_edgeFlow * 0.45))));
  float bl = orbBleed(suv, R, uP_reach, uP_edgeFlow) * uP_bleed * (0.7 + 0.6 * uOutput)
    * patchF * (0.1 + 0.9 * min(lum, 1.2));
  float leakOn = step(hash(cellIdx * 3.71 + 1.9), bl * 1.3) * (1.0 - mask);
  vec3 leak = orbsyFluoro(0.3 + 0.7 * min(bl, 1.0), uC_deep, uC_base, uC_hot) * shape * leakOn * min(bl * 1.5, 1.0);
  leak += uC_base * bevel * side * leakOn * min(bl, 1.0) * 0.4;
  float fPatch = mix(0.12, 1.0, smoothstep(0.38, 0.72, orbEdgeFbm(vec3(fuv * 3.2, uP_edgeFlow * 0.45))));
  float haze = orbBleed(fuv, R, uP_reach, uP_edgeFlow) * uP_bleed * (0.7 + 0.6 * uOutput) * fPatch * glowL;
  leak += uC_base * haze * 0.18 * (1.0 - orbOrganicMask(fuv, R, uP_organic, uP_edgeSoft, uP_edgeFlow));

  vec3 total = orbsyBloomTone(col * mask + leak, 1.0);
  float a = max(mask, clamp(max(total.r, max(total.g, total.b)) * 1.2, 0.0, 1.0));
  gl_FragColor = vec4(total, a);
}
`;

export const orbsy21Orb: OrbVariant = {
  key: "orbsy-21",
  label: "Mosaic Green",
  note: "SHDR-29's LED tile wall lit fluoro green, glowing bevels and white-hot blob cores",
  frag: ORBSY21_FRAG,
  params: [
    { key: "drift", label: "Drift", min: 0, max: 10, step: 0.05, default: 0.45, integrate: true },
    { key: "churn", label: "Churn", min: 0, max: 10, step: 0.05, default: 0.5, integrate: true },
    { key: "swirl", label: "Fluidity", min: 0, max: 3, step: 0.015, default: 1.2 },
    { key: "shuffle", label: "Shuffle", min: 0, max: 20, step: 0.1, default: 0.6, integrate: true },
    { key: "pulse", label: "Pulse depth", min: 0, max: 2, step: 0.01, default: 0 },
    { key: "spin", label: "Roll", min: 0, max: 5, step: 0.03, default: 0.1, integrate: true },
    { key: "radius", label: "Radius", min: 0.15, max: 3, step: 0.015, default: 0.84 },
    { key: "cells", label: "Tile grid", min: 16, max: 160, step: 2, default: 48 },
    { key: "scale", label: "Blob scale", min: 0.3, max: 10, step: 0.1, default: 1.3 },
    { key: "coverage", label: "Coverage", min: 0, max: 1.2, step: 0.01, default: 0.52 },
    { key: "confetti", label: "Accents", min: 0, max: 1, step: 0.01, default: 0.2 },
    { key: "core", label: "White-hot cores", min: 0.05, max: 1, step: 0.01, default: 0.3 },
    { key: "light", label: "Key light", min: 0, max: 3, step: 0.015, default: 0.6 },
    { key: "gain", label: "Panel gain", min: 0.05, max: 5, step: 0.05, default: 1 },
    { key: "burn", label: "Burn", min: 0.2, max: 3, step: 0.01, default: 1 },
    { key: "bevel", label: "Bevel glow", min: 0, max: 2, step: 0.01, default: 0.8 },
    { key: "bloom", label: "Bloom", min: 0, max: 2, step: 0.01, default: 0.8 },
    { key: "contrast", label: "Contrast", min: 0.15, max: 10, step: 0.05, default: 1 },
    { key: "organic", label: "Rim wander", min: 0, max: 0.15, step: 0.005, default: 0.035 },
    { key: "edgeSoft", label: "Rim feather", min: 0, max: 0.2, step: 0.005, default: 0.02 },
    { key: "bleed", label: "Energy bleed", min: 0, max: 3, step: 0.01, default: 0.9 },
    { key: "reach", label: "Bleed reach", min: 0.02, max: 0.5, step: 0.005, default: 0.1 },
    { key: "edgeFlow", label: "Edge flow", min: 0, max: 3, step: 0.01, default: 0.3, integrate: true }
  ],
  colors: [
    { key: "deep", label: "Deep", default: "#010d04" },
    { key: "base", label: "Fluoro", default: "#39ff14" },
    { key: "hot", label: "Hot", default: "#d6ff5c" },
    { key: "mint", label: "Mint accent", default: "#6affb0" },
    { key: "wall", label: "Wall", default: "#07140b" }
  ],
  /*
    Coverage is staged DOWN in the active states, as in SHDR-29: the
    synthesized volumes push it up, and the composition lives on its voids.
  */
  statePresets: {
    // idle FLOWS: blobs streaming and curling at lava-lamp pace, soft cores
    idle: {
      drift: 0.45, churn: 0.5, shuffle: 0.6, pulse: 0, spin: 0.1, coverage: 0.52, gain: 1,
      confetti: 0.18, core: 0.34, burn: 0.95, bevel: 0.7, bloom: 0.75, organic: 0.03, bleed: 0.8,
      reach: 0.09, edgeFlow: 0.25
    },
    // thinking BOILS: the stream stops, the warp churns hard, accents race
    thinking: {
      drift: 0.1, churn: 1.9, shuffle: 5, pulse: 0, spin: 0.03, coverage: 0.42, gain: 0.95,
      confetti: 0.3, core: 0.3, burn: 1.0, bevel: 0.9, bloom: 0.8, organic: 0.045, bleed: 1.0,
      reach: 0.1, edgeFlow: 0.7
    },
    // speaking PULSES: rings radiate through the wall, cores burning white
    speaking: {
      drift: 0.5, churn: 0.9, shuffle: 1.2, pulse: 0.55, spin: 0.45, coverage: 0.44, gain: 1.15,
      confetti: 0.22, core: 0.3, burn: 1.05, bevel: 1.1, bloom: 0.95, organic: 0.06, bleed: 1.3,
      reach: 0.13, edgeFlow: 1.0
    }
  },
  stateColors: {
    idle: { deep: "#010d04", base: "#39ff14", hot: "#d6ff5c", mint: "#6affb0" },
    thinking: { deep: "#010f08", base: "#2bff6a", hot: "#c4ffd0", mint: "#8affd8" },
    speaking: { deep: "#020f02", base: "#5cff1f", hot: "#eaff80", mint: "#a0ff9a" }
  }
};

export type Orbsy21Props = Omit<ShaderOrbProps, "variant">;

export function Orbsy21({ size = 280, ...rest }: Orbsy21Props) {
  return <ShaderOrb variant={orbsy21Orb} size={size} {...rest} />;
}

export default Orbsy21;
