/*
 * Orbsy 12 — Pixel Sort. Original shader, MIT.
 * Not a "use client" module, so server components can read the variant as data.
 * The shader lives in a template literal: its comments must not contain backticks.
 */
import { ShaderOrb, type OrbVariant, type ShaderOrbProps } from "../core/orbkit-core";
import { ORBSY_GLSL } from "./orbsy-glsl";

/*
  Pixel sorting wrapped round a turning ball. The sphere is cut into
  longitude columns. Down each column a scrolling 1D field is split into
  slots; wherever the slot's field value clears a threshold, a run of
  "sorted" pixels fills part of the slot: a smooth, stepped gradient from a
  hard white-hot head at the bottom to a dithered tail above, as if the
  column's bright pixels had been sorted and dripped downward along the
  surface. The field scrolls down each column at its own speed, and both
  the threshold and the run length breathe on a clock, so runs keep
  re-triggering, stretching and dying off.

  Under the sorts sits a dark green base texture: 3D fbm on the ball, Bayer
  dithered at 2px. Each head carries a soft vertical flare as bloom. A light
  CRT (scanlines, phosphor mask, roll bar) sits on top. Past the rim, the
  hottest columns drip on as screen-space streaks, gated by edge noise and
  by how bright the sorts are at the edge.
*/
const PIXEL_SORT_FRAG =
  ORBSY_GLSL +
  `
// One column of sorted runs. y is the column coordinate in [0,1] (0 at the
// bottom), col the column id, seed a layer id, ey one screen pixel in y.
// Returns (sorted fill, head, soft flare, base mask for dither).
vec4 sortColumn(float y, float col, float seed, float ey) {
  float h1 = hash31(vec3(col, seed, 1.3));
  float h2 = hash31(vec3(col, seed, 2.7));
  float slots = floor(mix(2.0, 5.0, h1));
  // runs drip downward: the scroll clock only translates the column
  float s = (y + fract(uP_drip * mix(0.05, 0.16, h2) + h1)) * slots;
  float slot = floor(s);
  float fy = fract(s);
  float epoch = floor(uP_drip * 0.4 + h2 * 7.0 + slot * 0.37);
  vec3 cid = vec3(col * 7.0 + slot, seed * 3.0 + epoch, seed);

  // the underlying field and its breathing threshold
  float f = hash31(cid) * 0.6 + 0.4 * noise3(vec3(col * 0.37, slot * 0.5, seed * 5.0 + uP_pulse * 0.3));
  float thr = uP_threshold + 0.14 * sin(uP_pulse + col * 0.21 + seed * 2.0) - 0.12 * uOutput;
  float on = step(thr, f);
  float over = clamp((f - thr) / max(1.0 - thr, 0.05), 0.0, 1.0);
  float len = clamp(mix(0.25, 1.0, over) * uP_runLen * (0.8 + 0.25 * sin(uP_pulse * 1.3 + col)), 0.08, 0.98);
  float start = hash31(cid + 5.0) * (1.0 - len);

  float u = (fy - start) / len; // 0 at the head (bottom), 1 at the tail
  float inRun = step(0.0, u) * step(u, 1.0) * on;
  // sorted gradient, stepped like quantized pixel values
  float g = 1.0 - clamp(u, 0.0, 1.0);
  g = floor(g * uP_steps + 0.5) / uP_steps;
  float fill = g * g * (0.5 + 0.5 * over) * inRun;

  float headW = max(ey * slots * 3.0, 0.015);
  float dh = (fy - start) / headW;
  float head = (1.0 - smoothstep(0.0, 1.0, abs(dh - 0.5) * 2.0 - 0.2)) * on;
  float flare = exp(-abs(fy - start) / (0.025 * len + 0.01)) * on * (0.4 + over);
  return vec4(fill, head * (0.6 + 0.6 * over), flare, inRun);
}

void main() {
  vec2 uv = orbUV();
  float px = orbsyPx();
  float R = uP_radius * (1.0 + 0.03 * uOutput);
  float r = length(uv);
  vec2 fc = orbFragCoord(uv);

  float mask = orbOrganicMask(uv, R, uP_organic, uP_edgeSoft, uP_edgeFlow);
  vec4 sp = orbsySphere(orbRimUV(uv, R), R, px);
  vec3 n = sp.xyz;
  n.yz = orbsyRot(0.18) * n.yz;
  n.xz = orbsyRot(uP_spin) * n.xz;

  float lon = atan(n.x, n.z) / TAU + 0.5;
  float lat = asin(clamp(n.y, -1.0, 1.0)) / PI + 0.5;
  float cl = max(sqrt(max(1.0 - n.y * n.y, 0.0)), 0.06);
  float fz = max(sp.z, 0.1);
  float ey = px / (PI * R * fz);
  float ex = px / (TAU * R * cl * fz);

  // columns with a thin dark gap between them
  float cols = uP_columns;
  float cx = lon * cols;
  float col = floor(cx);
  float fx = fract(cx);
  float gw = min(ex * cols * 0.9, 0.3);
  float colMask = smoothstep(0.0, gw, fx) * smoothstep(0.0, gw, 1.0 - fx);
  float pole = smoothstep(0.1, 0.35, cl);

  vec4 A = sortColumn(lat, col, 1.0, ey);
  // a second, coarser layer on double-width columns
  float col2 = floor(lon * cols * 0.5);
  vec4 B = sortColumn(lat, col2 + 101.0, 2.0, ey);

  // base texture: dark dithered fbm on the ball
  float bayer = orbsyBayer8(floor(fc * 0.5));
  float tex = fbm3(n * uP_scale + vec3(0.0, uP_pulse * 0.05, 0.0));
  float baseE = smoothstep(0.42, 0.78, tex) * uP_base;
  float dotd = length(fract(fc / 3.0) - 0.5);
  baseE = step(bayer, baseE * 1.3) * 0.38 * (1.0 - smoothstep(0.3, 0.5, dotd));

  // tails of the sorts go to a dither as they fade
  float fillA = A.x;
  float dA = step(bayer, fillA * 1.6);
  fillA = mix(fillA, max(fillA, 0.35 * dA * A.w), uP_dither) * mix(1.0, dA * 0.6 + 0.4, uP_dither * step(fillA, 0.45));
  float fillB = B.x * 0.7;

  float vol = uP_bright * (0.85 + 0.6 * uOutput);
  float heads = max(A.y, B.y * 0.8);
  float E = (max(fillA, fillB) * 1.1 + heads * uP_headHot) * colMask * pole;
  E += baseE * pole * (1.0 - A.w);
  float shade = mix(0.35, 1.0, sp.z);
  E *= shade * vol;
  vec3 colr = orbsyFluoro(E, uC_deep, uC_base, uC_hot) * step(0.004, E);
  // bloom: a soft vertical flare round each head, spilling over the gaps
  float flare = (A.z + 0.6 * B.z) * pole * shade;
  colr += uC_base * flare * uP_bloom * 0.3 * vol + vec3(0.82, 1.0, 0.9) * heads * uP_bloom * 0.12 * pole * shade;
  colr *= mask;

  // Drips past the rim: screen-space columns, only where the edge sorts are hot.
  float edgeHot = clamp(E + flare * 0.5, 0.0, 1.5);
  float pf = mix(0.12, 1.0, smoothstep(0.38, 0.72, orbEdgeFbm(vec3(uv * 3.2, uP_edgeFlow * 0.45))));
  float bl = orbBleed(uv, R, uP_reach, uP_edgeFlow) * uP_bleed * (0.7 + 0.6 * uOutput) * pf * edgeHot;
  float sc = floor(uv.x / (px * 3.0));
  float ch = hash31(vec3(sc, 4.0, 9.0));
  float dr = fract(uv.y * mix(2.0, 5.0, ch) + uP_edgeFlow * mix(0.5, 1.2, ch) + ch);
  float drip = dr * dr * step(0.45, ch);
  float oe = bl * (drip * 1.3 + 0.06);
  colr += orbsyFluoro(oe, uC_deep, uC_base, uC_hot) * min(oe * 2.0, 1.0) * (1.0 - mask);

  // light CRT
  colr *= orbsyScanline(fc, 3.0, 0.4 * uP_crt);
  colr *= orbsyPhosphorMask(fc, 0.3 * uP_crt);
  colr *= 1.0 + orbsyRollBar(uv, uP_drip) * 0.35 * uP_crt;

  colr = orbsyBloomTone(colr, uP_exposure);
  float a = clamp(max(colr.r, max(colr.g, colr.b)) * 1.2, 0.0, 1.0);
  gl_FragColor = vec4(colr, a);
}
`;

export const orbsy12Orb: OrbVariant = {
  key: "orbsy-12",
  label: "Pixel Sort",
  note: "pixel-sorted runs dripping down the longitude columns of a turning ball, white-hot heads over a dithered base, light CRT",
  frag: PIXEL_SORT_FRAG,
  params: [
    { key: "drip", label: "Drip speed", min: 0, max: 4, step: 0.01, default: 0.6, integrate: true },
    { key: "pulse", label: "Re-sort rate", min: 0, max: 3, step: 0.01, default: 0.4, integrate: true },
    { key: "spin", label: "Spin rate", min: 0, max: 2, step: 0.01, default: 0.1, integrate: true },
    { key: "radius", label: "Radius", min: 0.3, max: 1, step: 0.01, default: 0.79 },
    { key: "columns", label: "Columns", min: 16, max: 120, step: 1, default: 56 },
    { key: "threshold", label: "Sort threshold", min: 0, max: 1, step: 0.01, default: 0.5 },
    { key: "runLen", label: "Run length", min: 0.1, max: 1.2, step: 0.01, default: 0.75 },
    { key: "steps", label: "Sort steps", min: 3, max: 24, step: 1, default: 10 },
    { key: "headHot", label: "Head burn", min: 0, max: 3, step: 0.01, default: 1.6 },
    { key: "dither", label: "Tail dither", min: 0, max: 1, step: 0.01, default: 0.7 },
    { key: "base", label: "Base texture", min: 0, max: 1.5, step: 0.01, default: 0.7 },
    { key: "scale", label: "Base scale", min: 0.5, max: 6, step: 0.05, default: 2.5 },
    { key: "bright", label: "Brightness", min: 0.2, max: 3, step: 0.01, default: 1.1 },
    { key: "bloom", label: "Bloom", min: 0, max: 2, step: 0.01, default: 0.8 },
    { key: "crt", label: "CRT", min: 0, max: 1, step: 0.01, default: 0.5 },
    { key: "exposure", label: "Exposure", min: 0.3, max: 3, step: 0.01, default: 1.0 },
    { key: "organic", label: "Rim wander", min: 0, max: 0.15, step: 0.005, default: 0.035 },
    { key: "edgeSoft", label: "Rim feather", min: 0, max: 0.2, step: 0.005, default: 0.03 },
    { key: "bleed", label: "Energy bleed", min: 0, max: 3, step: 0.01, default: 1.0 },
    { key: "reach", label: "Bleed reach", min: 0.02, max: 0.5, step: 0.005, default: 0.12 },
    { key: "edgeFlow", label: "Edge flow", min: 0, max: 3, step: 0.01, default: 0.35, integrate: true }
  ],
  colors: [
    { key: "deep", label: "Deep", default: "#010f08" },
    { key: "base", label: "Fluoro", default: "#1bd26a" },
    { key: "hot", label: "Hot", default: "#8ff2b8" }
  ],
  statePresets: {
    // slow drips, few long sorts, calm re-sorting
    idle: {
      drip: 0.4, pulse: 0.25, spin: 0.08, columns: 48, threshold: 0.52, runLen: 0.85, steps: 10,
      headHot: 1.4, dither: 0.7, base: 0.7, bright: 1.0, bloom: 0.7, crt: 0.45,
      exposure: 1.0, organic: 0.03, bleed: 0.8, reach: 0.1, edgeFlow: 0.25
    },
    // busy: fine columns, short fast runs re-triggering everywhere
    thinking: {
      drip: 2.0, pulse: 1.6, spin: 0.25, columns: 84, threshold: 0.42, runLen: 0.45, steps: 6,
      headHot: 1.6, dither: 0.85, base: 0.8, bright: 1.05, bloom: 0.7, crt: 0.65,
      exposure: 1.05, organic: 0.045, bleed: 1.0, reach: 0.12, edgeFlow: 0.8
    },
    // brightest: wide columns, long dense sorts flaring with the voice
    speaking: {
      drip: 1.1, pulse: 0.8, spin: 0.12, columns: 40, threshold: 0.36, runLen: 1.0, steps: 14,
      headHot: 2.2, dither: 0.5, base: 0.9, bright: 1.35, bloom: 1.2, crt: 0.45,
      exposure: 1.25, organic: 0.06, bleed: 1.5, reach: 0.15, edgeFlow: 1.1
    }
  },
  stateColors: {
    idle: { deep: "#010f08", base: "#1bd26a", hot: "#8ff2b8" },
    thinking: { deep: "#010f09", base: "#17cf8c", hot: "#a4f5dc" },
    speaking: { deep: "#02110b", base: "#2ee87c", hot: "#b6ffd2" }
  }
};

export type Orbsy12Props = Omit<ShaderOrbProps, "variant">;

export function Orbsy12({ size = 280, ...rest }: Orbsy12Props) {
  return <ShaderOrb variant={orbsy12Orb} size={size} {...rest} />;
}

export default Orbsy12;
