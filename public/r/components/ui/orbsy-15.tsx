/*
 * Orbsy 15 — Glitch Blocks. Original shader, MIT.
 * Not a "use client" module, so server components can read the variant as data.
 * The shader lives in a template literal: its comments must not contain backticks.
 */
import { ShaderOrb, type OrbVariant, type ShaderOrbProps } from "@/components/ui/orbkit-core";
import { ORBSY_GLSL } from "@/components/ui/orbsy-glsl";

/*
  Block glitch wrapped round a ball. The sphere is cut into latitude rows, and
  each row carries a ring of rectangles stretched along the longitude that slide
  round at their own speed and direction, reseeding on a stepped clock. Every
  block has its own brightness, a soft gradient toward a bright leading edge,
  blocky internal mottling and, sometimes, a smeared ghost trailing behind it.
  A fine and a coarse layer add up as light. The fill is ordered-dithered on a
  dot screen, a wide soft copy of the same blocks gives the bloom, and a CRT
  pass (screen-space tears, a green/cyan split, scanlines, phosphor mask and a
  roll bar) sits on top. Past the rim, screen-space block smears escape.
*/
const ORBSY15_FRAG =
  ORBSY_GLSL +
  `
// One layer of sliding blocks. g.x wraps in [0,1) (longitude), g.y in [0,1]
// (latitude). ex / ey are one screen pixel in g units. sph is 1 when g is the
// sphere (rows are latitude rings), 0 for flat screen-space use. Returns hard
// energy, soft (bloom) energy and the bright edge.
vec3 glitchLayer(vec2 g, float rows, float seed, float t, float ex, float ey, float dens, float sph) {
  float yy = g.y * rows;
  float row = floor(yy);
  float fy = fract(yy);
  float h1 = hash31(vec3(row, seed, 1.7));
  float h2 = hash31(vec3(row, seed, 2.9));
  float spd = (h1 < 0.5 ? -1.0 : 1.0) * mix(0.25, 1.0, h2);
  /*
    Even coverage. The tilt shows the north cap, where rows are short and both
    sides of each ring are in view, so the top half always holds many small
    blocks; the bottom half looks at the widest rings, which with a fixed 4 to
    11 cells per ring held only a few huge blocks and read as sparse. Cells per
    ring now follow the ring's circumference, and the rings the tilt only ever
    shows in the lower half get a touch more density.
  */
  float rl = (row + 0.5) / rows;
  float ring = cos((rl - 0.5) * PI);
  float n = max(floor(mix(4.0, 11.0, hash31(vec3(row, seed, 3.3))) * (1.0 + 0.8 * sph * (ring - 0.6))), 3.0);
  dens += (1.0 - dens) * 0.25 * sph * (1.0 - smoothstep(0.4, 0.62, rl));
  // t only ever enters as a wrapped translation along the row
  float x = fract(g.x + fract(t * spd * 0.08)) * n;
  float cell = floor(x);
  float fx = fract(x);
  float epoch = floor(t * 0.35 + h2 * 9.0 + 40.0);
  vec3 cid = vec3(row * 13.0 + cell, seed * 7.0 + epoch, seed);

  float a = hash31(cid) * 0.45;
  float b = a + mix(0.3, 1.0 - a, hash31(cid + 11.0));
  float y0 = hash31(cid + 23.0) * 0.35;
  float y1 = 1.0 - hash31(cid + 31.0) * 0.35;
  // stratified along the ring: each row lights about dens of its cells, spread
  // round it, so no ring goes dark by chance
  float on = step(fract(hash31(vec3(row, cid.y, seed + 4.1)) + cell * 0.618034), dens);
  float hb = hash31(cid + 53.0);
  float bright = mix(0.2, 1.75, hb * hb);

  float wx = ex * n * 0.8;
  float wy = ey * rows * 0.8;
  float cx = smoothstep(a - wx, a + wx, fx) * (1.0 - smoothstep(b - wx, b + wx, fx));
  float cy = smoothstep(y0 - wy, y0 + wy, fy) * (1.0 - smoothstep(y1 - wy, y1 + wy, fy));
  float hard = cx * cy * on;

  // wide copy of the same rectangle: the bloom
  float sx = 0.14;
  float sy = 0.45;
  float soft = smoothstep(a - sx, a + sx, fx) * (1.0 - smoothstep(b - sx, b + sx, fx))
             * smoothstep(y0 - sy, y0 + sy, fy) * (1.0 - smoothstep(y1 - sy, y1 + sy, fy)) * on;

  // content moves toward lower fx when spd > 0, so the leading side is a
  float u = clamp((fx - a) / max(b - a, 1e-3), 0.0, 1.0);
  float lead = spd > 0.0 ? 1.0 - u : u;
  float grad = mix(0.3, 1.0, lead * lead);
  float sub = hash31(vec3(floor(u * 5.0), floor(fy * 2.0), cid.x + cid.y * 3.0));
  float fill = grad * mix(0.55, 1.0, sub);

  float dLead = (spd > 0.0 ? fx - a : b - fx) / max(ex * n, 1e-5);
  float dTop = min(fy - y0, y1 - fy) / max(ey * rows, 1e-5);
  float edge = max(exp(-max(dLead, 0.0) / 1.4), 0.55 * exp(-max(dTop, 0.0) / 0.9)) * hard;

  // ghost smear trailing the block
  float db = spd > 0.0 ? fx - b : a - fx;
  float ghostOn = step(0.55, hash31(cid + 67.0)) * on;
  float ghost = db > 0.0 ? exp(-db * 7.0) * cy * ghostOn * 0.45 : 0.0;

  return vec3((hard * fill + ghost) * bright, soft * bright, edge * bright);
}

vec3 glitchField(vec2 g, float t, float ex, float ey) {
  vec3 fine = glitchLayer(g, uP_rows, 1.0, t, ex, ey, uP_density, 1.0);
  vec3 coarse = glitchLayer(g, floor(uP_rows * 0.45), 2.0, t * 0.6, ex, ey, uP_density * 0.7, 1.0);
  return fine + coarse * vec3(0.7, 0.8, 0.8);
}

void main() {
  vec2 uv = orbUV();
  float px = orbsyPx();
  float R = uP_radius * (1.0 + 0.03 * uOutput);
  float t = uP_speed;
  float r = length(uv);
  vec2 fc = orbFragCoord(uv);

  // Screen-space tears: a few bands jump sideways on a stepped clock.
  float band = floor(uv.y * 38.0);
  float tick = floor(t * 7.0);
  float th = hash31(vec3(band, tick, 3.0));
  float tearOn = step(1.0 - uP_glitch * (0.12 + 0.2 * uOutput), th);
  float tear = tearOn * (hash31(vec3(band, tick, 9.0)) - 0.5) * 0.14;
  vec2 tuv = uv + vec2(tear, 0.0);

  float mask = orbOrganicMask(tuv, R, uP_organic, uP_edgeSoft, uP_edgeFlow);
  vec4 s = orbsySphere(orbRimUV(tuv, R), R, px);
  vec3 n = s.xyz;
  n.yz = orbsyRot(0.28) * n.yz;
  n.xz = orbsyRot(uP_spin) * n.xz;

  float lon = atan(n.x, n.z) / TAU + 0.5;
  float lat = asin(clamp(n.y, -1.0, 1.0)) / PI + 0.5;
  float cl = max(sqrt(max(1.0 - n.y * n.y, 0.0)), 0.06);
  float fz = max(s.z, 0.1);
  float ex = px / (TAU * R * cl * fz);
  float ey = px / (PI * R * fz);

  vec3 A = glitchField(vec2(lon, lat), t, ex, ey);
  // channel split: the same blocks a few pixels over feed a cyan fringe
  float dl = uP_split * (1.0 + 2.0 * tearOn) * ex;
  vec3 B = glitchField(vec2(lon + dl, lat), t, ex, ey);
  float pole = smoothstep(0.08, 0.3, cl);
  A *= pole;
  B *= pole;

  // Ordered dither at 2px on a fine dot screen.
  float lv = 5.0;
  float bay = orbsyBayer8(floor(fc * 0.5));
  float dq = floor(A.x * lv + bay) / lv;
  float fillE = mix(A.x, dq, uP_dither);
  float dotd = length(fract(fc / 3.0) - 0.5);
  float dots = 1.0 - smoothstep(0.25, 0.5, dotd);
  fillE *= mix(1.0, 0.5 + 0.75 * dots, uP_dither);

  float shade = mix(0.4, 1.0, s.z);
  float body = 0.05 + 0.04 * step(0.93, fract(lat * uP_rows)) * pole;
  float E = (fillE + A.z * 1.6 + body) * shade * uP_bright * (0.85 + 0.6 * uOutput);
  vec3 col = orbsyFluoro(E, uC_deep, uC_base, uC_hot);
  col += vec3(0.0, 0.35, 0.55) * max(B.x - A.x, 0.0) * uP_bright * 0.8;
  col += uC_base * pow(1.0 - s.z, 3.0) * 0.5;
  // bloom: the wide soft copy of the blocks
  vec3 glow = orbsyFluoro(A.y * 0.9, uC_deep, uC_base, uC_hot) * uP_bloom * 0.55 * shade;
  col = col * mask + glow * mask;

  // Escaping smears: screen-space block rows fade out along the bleed.
  float bl = orbBleed(uv, R, uP_reach, uP_edgeFlow) * uP_bleed * (0.7 + 0.6 * uOutput);
  vec2 sg = vec2(uv.x * 0.25 + 0.5, uv.y * 0.5 + 0.5);
  vec3 O = glitchLayer(sg, 46.0, 5.0, t * 1.4, px * 0.25, px * 0.5, 0.55, 0.0);
  float oe = O.x * mix(1.0, 0.55 + 0.7 * dots, uP_dither) + O.z;
  vec3 outer = orbsyFluoro(oe * 1.1, uC_deep, uC_base, uC_hot) + uC_base * O.y * uP_bloom * 0.3;
  float halo = exp(-max(r - R, 0.0) / 0.05) * uP_bloom * 0.18;
  col += (outer * bl + uC_base * halo) * (1.0 - mask);

  // CRT
  float crt = uP_crt;
  col *= orbsyScanline(fc, 3.0, 0.45 * crt);
  col *= orbsyPhosphorMask(fc, 0.35 * crt);
  col += uC_base * orbsyRollBar(uv, t * 2.0) * 0.12 * crt * max(mask, bl);

  col = orbsyBloomTone(col, 1.0);
  float a = clamp(max(col.r, max(col.g, col.b)) * 1.2, 0.0, 1.0);
  gl_FragColor = vec4(col, a);
}
`;

export const orbsy15Orb: OrbVariant = {
  key: "orbsy-15",
  label: "Glitch Blocks",
  note: "stretched dithered blocks sliding round the sphere in rows, torn and split on a CRT",
  frag: ORBSY15_FRAG,
  params: [
    { key: "speed", label: "Slide speed", min: 0, max: 3, step: 0.01, default: 0.4, integrate: true },
    { key: "spin", label: "Spin rate", min: 0, max: 2, step: 0.01, default: 0.08, integrate: true },
    { key: "radius", label: "Radius", min: 0.3, max: 1, step: 0.01, default: 0.79 },
    { key: "rows", label: "Rows", min: 6, max: 40, step: 1, default: 18 },
    { key: "density", label: "Block density", min: 0, max: 1, step: 0.01, default: 0.55 },
    { key: "bright", label: "Brightness", min: 0.2, max: 3, step: 0.01, default: 1.1 },
    { key: "glitch", label: "Tearing", min: 0, max: 1, step: 0.01, default: 0.15 },
    { key: "split", label: "Channel split", min: 0, max: 8, step: 0.1, default: 2.5 },
    { key: "dither", label: "Dither screen", min: 0, max: 1, step: 0.01, default: 0.7 },
    { key: "bloom", label: "Bloom", min: 0, max: 2, step: 0.01, default: 0.7 },
    { key: "crt", label: "CRT", min: 0, max: 1, step: 0.01, default: 0.7 },
    { key: "organic", label: "Rim wander", min: 0, max: 0.15, step: 0.005, default: 0.035 },
    { key: "edgeSoft", label: "Rim feather", min: 0, max: 0.2, step: 0.005, default: 0.03 },
    { key: "bleed", label: "Energy bleed", min: 0, max: 3, step: 0.01, default: 0.9 },
    { key: "reach", label: "Bleed reach", min: 0.02, max: 0.5, step: 0.005, default: 0.1 },
    { key: "edgeFlow", label: "Edge flow", min: 0, max: 3, step: 0.01, default: 0.3, integrate: true }
  ],
  colors: [
    { key: "deep", label: "Deep", default: "#010d04" },
    { key: "base", label: "Fluoro", default: "#39ff14" },
    { key: "hot", label: "Hot", default: "#d6ff5c" }
  ],
  statePresets: {
    // slow drift, a steady scatter of blocks, barely any tearing
    idle: {
      speed: 0.35, spin: 0.06, rows: 16, density: 0.66, bright: 1.0, glitch: 0.08, split: 2.0,
      dither: 0.7, bloom: 0.6, crt: 0.65, organic: 0.03, bleed: 0.8, reach: 0.09, edgeFlow: 0.25
    },
    // busy: fine rows racing and reseeding, heavy tears and channel split
    thinking: {
      speed: 1.6, spin: 0.2, rows: 28, density: 0.72, bright: 1.1, glitch: 0.75, split: 5.5,
      dither: 0.85, bloom: 0.7, crt: 0.85, organic: 0.05, bleed: 1.1, reach: 0.11, edgeFlow: 0.8
    },
    // brightest: big dense blocks flaring with the voice
    speaking: {
      speed: 0.9, spin: 0.12, rows: 14, density: 0.8, bright: 1.55, glitch: 0.3, split: 3.0,
      dither: 0.55, bloom: 1.2, crt: 0.6, organic: 0.07, bleed: 1.5, reach: 0.14, edgeFlow: 1.0
    }
  },
  stateColors: {
    idle: { deep: "#010d04", base: "#39ff14", hot: "#d6ff5c" },
    thinking: { deep: "#010f08", base: "#2bff6a", hot: "#b8ffd0" },
    speaking: { deep: "#020f02", base: "#5cff1f", hot: "#eaff7a" }
  }
};

export type Orbsy15Props = Omit<ShaderOrbProps, "variant">;

export function Orbsy15({ size = 280, ...rest }: Orbsy15Props) {
  return <ShaderOrb variant={orbsy15Orb} size={size} {...rest} />;
}

export default Orbsy15;
