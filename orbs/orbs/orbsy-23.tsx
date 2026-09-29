/*
 * Orbsy 23 — Lens Lattice. Original shader, MIT.
 * An original work inspired by the look of Orbkit's SHDR-05; it shares no code with it.
 * Not a "use client" module, so server components can read the variant as data.
 * The shader lives in a template literal: its comments must not contain backticks.
 */
import { ShaderOrb, type OrbVariant, type ShaderOrbProps } from "../core/orbkit-core";
import { ORBSY_GLSL } from "./orbsy-glsl";

/*
  An emerald glass ball faceted into a honeycomb of small lenses, each one
  bending its own view of a shared field of travelling bands.

  - LATTICE. The sphere normal (in a gently wobbling body frame) is projected
    stereographically from the far pole. That map is conformal, so a hex grid
    laid on the plane stays hexagonal on the ball, with the cells swelling a
    little toward the limb like a real faceted lens.
  - LENSES. Every hex cell is a convex cap. Its slope points radially out
    from the centre; its size comes from a blend of the round and the hex
    distance to the centre (the hex part squares the rings off toward the
    six walls, like a cut facet), shaped by the slope of a
    spherical cap, h / sqrt(1 - h^2), so it steepens sharply at the walls.
    The slope displaces the lookup into the band field (a refraction offset);
    a hashed tilt per cell and an occasional concave cell (negative power)
    make each lens show a different piece of the field. Because the offset
    grows steeply at the walls, bands crowd and pinch there and break across
    each wall.
  - BANDS. The field is a blend of concentric rings around a drifting centre
    and flowing horizontal waves, warped by slow noise. It is sampled as three
    phase-shifted channels: a deep emerald shoulder on one side, the brand
    green in the middle, an aqua-mint shoulder on the other, and a narrow
    white-hot core where they meet.
  - AA. The band phase is evaluated at two neighbouring pixels too; the phase
    step per pixel widens the band edges and, where bands get finer than a
    few pixels (cell walls, the limb), fades them to their mean.
  - FINISH. Bevel highlights on the walls facing a key light, emissive limb
    shading, a glassy rim sheen that comes and goes around the rim, and bleed
    past the rim fed only where the rim content is bright.
*/
const ORBSY23_FRAG =
  ORBSY_GLSL +
  `
vec2 llHash2(vec2 c) {
  return vec2(hash31(vec3(c, 3.7)), hash31(vec3(c, 11.3)));
}

// Hex cell at p: xy offset from the cell centre, zw the cell id (centre).
vec4 llHex(vec2 p) {
  vec2 s = vec2(1.0, 1.7320508);
  vec2 a = mod(p, s) - 0.5 * s;
  vec2 b = mod(p - 0.5 * s, s) - 0.5 * s;
  vec2 g = dot(a, a) < dot(b, b) ? a : b;
  return vec4(g, p - g);
}

// Stereographic lattice coordinates of a screen point on the ball.
vec3 llNormal(vec2 uv, float R, float px) {
  vec3 n = orbsySphere(orbRimUV(uv, R), R, px).xyz;
  n.yz = orbsyRot(-0.3 + 0.22 * sin(uP_spin * 0.61)) * n.yz;
  n.xz = orbsyRot(0.35 * sin(uP_spin * 0.43)) * n.xz;
  return n;
}

/*
  The lens lattice for screen point uv.
  x: band phase (in band periods), y: normalised hex distance to the wall,
  z: bevel light on the walls, w: 1.0 for a concave cell.
*/
vec4 llField(vec2 uv, float R, float px, float voice) {
  vec3 n = llNormal(uv, R, px);
  vec2 p0 = n.xy / (1.0 + max(n.z, -0.6));
  p0 = orbsyRot(uP_spin * 0.17) * p0;

  float cells = uP_cells;
  vec4 hx = llHex(p0 * cells);
  vec2 g = hx.xy;
  // integer cell id: centres sit on a half-unit by half-row lattice, and the
  // raw subtraction wobbles in the last bits, which a hash would amplify
  vec2 id = floor(hx.zw * vec2(2.0, 1.1547005) + 0.5);
  vec2 ag = abs(g);
  float dFlat = ag.x;
  float dSlant = dot(ag, vec2(0.5, 0.8660254));
  float dh = max(dFlat, dSlant) * 2.0;
  float dr = length(g) * 2.0;
  vec2 rdir = g / max(length(g), 1e-4);

  float h = clamp(mix(dr, dh, uP_facet), 0.0, 1.0);
  vec2 dir = rdir;
  float slope = h / sqrt(1.0 - 0.94 * h * h);

  vec2 hr = llHash2(id);
  float concave = step(1.0 - uP_concave, hr.x);
  float power = uP_refract * (1.0 + 0.35 * voice) * mix(0.75, 1.25, hr.y) * (1.0 - 2.0 * concave);
  vec2 tilt = (llHash2(id + 17.0) - 0.5) * uP_tilt;
  vec2 q = p0 + (dir * slope * power + tilt) / cells;

  // Shared band field: rings around a drifting centre, or flowing waves.
  vec2 c = 0.45 * vec2(sin(uP_drift * 0.71), cos(uP_drift * 0.53));
  float rings = length(q - c);
  float waves = q.y + 0.28 * sin(q.x * 1.7 + uP_drift) + 0.12 * sin(q.x * 3.1 - uP_drift * 1.3);
  float warp = noise3(vec3(q * 1.1, uP_drift * 0.35)) - 0.5;
  float phi = mix(rings, waves, uP_shape) * uP_bands + warp * uP_warp - uP_speed;

  float bevel = smoothstep(0.62, 1.0, h) * dot(dir, normalize(vec2(-0.6, 0.8)));
  return vec4(phi, dh, bevel, concave);
}

// One antialiased band channel at phase offset k: soft shoulders, sharp top.
float llBand(float phi, float k, float wid, float fw) {
  float x = abs(fract(phi + k) - 0.5) * 2.0;
  float w = wid + fw;
  float b = 1.0 - smoothstep(0.0, w, x);
  b *= b;
  return mix(b, wid * 0.14, smoothstep(0.15, 0.5, fw));
}

void main() {
  vec2 uv = orbUV();
  float px = orbsyPx();
  float voice = uP_react * uOutput;
  float listen = uP_react * uInput;
  float R = uP_radius * (1.0 + 0.02 * voice);
  float r = length(uv);

  float mask = orbOrganicMask(uv, R, uP_organic, uP_edgeSoft, uP_edgeFlow);
  vec4 s = orbsySphere(orbRimUV(uv, R), R, px);

  vec4 F = llField(uv, R, px, voice);
  float phX = llField(uv + vec2(px, 0.0), R, px, voice).x;
  float phY = llField(uv + vec2(0.0, px), R, px, voice).x;
  vec2 dph = vec2(phX - F.x, phY - F.x);
  // a jump across a cell wall is not a frequency: keep the smaller step
  float fw = min(length(dph), min(abs(dph.x), abs(dph.y)) * 1.8 + 0.05) * 2.0;
  fw = clamp(fw, 0.0, 1.0);

  float phi = F.x;
  float sep = uP_split * (1.0 + 0.3 * listen);
  float wid = uP_width * (1.0 + 0.45 * voice);
  float chA = llBand(phi, -sep, wid, fw);
  float chB = llBand(phi, 0.0, wid, fw);
  float chC = llBand(phi, sep, wid, fw);
  float core = llBand(phi, 0.0, wid * 0.35, fw);

  vec3 emerald = uC_base * vec3(0.1, 0.62, 0.36);
  vec3 aqua = min(uC_hot * vec3(0.6, 1.0, 1.12) + vec3(0.0, 0.05, 0.12), vec3(1.2));
  vec3 col = uC_deep * 0.6;
  col += emerald * chA * 1.4;
  col += uC_base * chB * 1.0;
  col += aqua * chC * 0.75;
  col += vec3(1.0) * core * uP_core * (1.0 + 0.6 * voice);

  // bevels on the lens walls, lit from the upper left
  float bev = max(F.z, 0.0);
  // a thin dark seam where two lenses meet keeps the lattice graphic
  float seam = smoothstep(0.93, 0.995, F.y);
  col *= 1.0 - 0.75 * seam;
  col += mix(uC_hot, vec3(1.0), 0.4) * bev * bev * uP_bevel * (1.0 - seam);
  col *= mix(1.0, 0.7, F.w * 0.4);

  // emissive limb falloff, and a glass sheen that varies around the rim
  float limb = mix(0.35, 1.0, smoothstep(0.0, 0.55, s.z));
  col *= limb * uP_exposure * (1.0 + 0.3 * voice);
  float sheenPatch = smoothstep(0.35, 0.75, orbEdgeFbm(vec3(uv * 2.6, uP_edgeFlow * 0.4 + 7.0)));
  float fres = pow(1.0 - s.z, 4.0);
  col += mix(uC_hot, vec3(1.0), 0.5) * fres * sheenPatch * uP_sheen;

  // past the rim: bleed broken into patches, fed only by bright rim content
  float rimE = max(col.r, max(col.g, col.b));
  float hotRim = mix(smoothstep(0.2, 1.4, rimE), sheenPatch, 0.5);
  float bl = orbBleed(uv, R, uP_reach, uP_edgeFlow) * uP_bleed * (0.7 + 0.6 * uOutput);
  float rimPatch = smoothstep(0.38, 0.72, orbEdgeFbm(vec3(uv * 3.2, uP_edgeFlow * 0.45)));
  vec3 outer = mix(uC_base, aqua, 0.3) * bl * mix(0.12, 1.0, rimPatch) * (0.2 + 0.8 * hotRim);
  col = col * mask + outer * (1.0 - mask);

  col = orbsyBloomTone(col, 1.0);
  gl_FragColor = vec4(col, clamp(max(col.r, max(col.g, col.b)) * 1.2, 0.0, 1.0));
}
`;

export const orbsy23Orb: OrbVariant = {
  key: "orbsy-23",
  label: "Lens Lattice",
  note: "an emerald glass ball faceted into a honeycomb of lenses, each bending travelling white-hot bands with green chromatic shoulders",
  frag: ORBSY23_FRAG,
  params: [
    { key: "speed", label: "Band travel", min: 0, max: 3, step: 0.01, default: 0.25, integrate: true },
    { key: "drift", label: "Field drift", min: 0, max: 2, step: 0.01, default: 0.12, integrate: true },
    { key: "spin", label: "Lattice sway", min: 0, max: 2, step: 0.01, default: 0.1, integrate: true },
    { key: "radius", label: "Radius", min: 0.3, max: 1, step: 0.01, default: 0.79 },
    { key: "cells", label: "Lens density", min: 0.8, max: 6, step: 0.01, default: 1.6 },
    { key: "facet", label: "Hex facet", min: 0, max: 1, step: 0.01, default: 0.5 },
    { key: "refract", label: "Refraction", min: 0, max: 2, step: 0.01, default: 0.55 },
    { key: "tilt", label: "Lens tilt", min: 0, max: 1.5, step: 0.01, default: 0.5 },
    { key: "concave", label: "Concave cells", min: 0, max: 0.6, step: 0.01, default: 0.25 },
    { key: "bands", label: "Band count", min: 0.5, max: 12, step: 0.01, default: 2.6 },
    { key: "shape", label: "Rings to waves", min: 0, max: 1, step: 0.01, default: 0.3 },
    { key: "warp", label: "Warp", min: 0, max: 3, step: 0.01, default: 0.8 },
    { key: "width", label: "Band width", min: 0.1, max: 0.9, step: 0.01, default: 0.42 },
    { key: "split", label: "Chromatic split", min: 0, max: 0.3, step: 0.005, default: 0.09 },
    { key: "core", label: "White core", min: 0, max: 3, step: 0.01, default: 1.4 },
    { key: "bevel", label: "Wall bevel", min: 0, max: 2, step: 0.01, default: 0.5 },
    { key: "sheen", label: "Rim sheen", min: 0, max: 2, step: 0.01, default: 0.6 },
    { key: "exposure", label: "Exposure", min: 0.3, max: 3, step: 0.01, default: 1.1 },
    { key: "react", label: "Voice react", min: 0, max: 2, step: 0.01, default: 1.0 },
    { key: "organic", label: "Rim wander", min: 0, max: 0.15, step: 0.005, default: 0.03 },
    { key: "edgeSoft", label: "Rim feather", min: 0, max: 0.2, step: 0.005, default: 0.025 },
    { key: "bleed", label: "Energy bleed", min: 0, max: 3, step: 0.01, default: 0.7 },
    { key: "reach", label: "Bleed reach", min: 0.02, max: 0.5, step: 0.005, default: 0.08 },
    { key: "edgeFlow", label: "Edge flow", min: 0, max: 3, step: 0.01, default: 0.3, integrate: true }
  ],
  colors: [
    { key: "deep", label: "Deep", default: "#010f08" },
    { key: "base", label: "Fluoro", default: "#1bd26a" },
    { key: "hot", label: "Hot", default: "#8ff2b8" }
  ],
  statePresets: {
    idle: {
      speed: 0.2, drift: 0.1, spin: 0.08, cells: 1.5, facet: 0.5, refract: 0.6, tilt: 0.45, concave: 0.25,
      bands: 2.8, shape: 0.2, warp: 0.7, width: 0.28, split: 0.15, core: 1.1, bevel: 0.5, sheen: 0.6,
      exposure: 1.05, react: 0.8, organic: 0.03, bleed: 0.5, reach: 0.08, edgeFlow: 0.25
    },
    thinking: {
      speed: 1.4, drift: 0.35, spin: 0.25, cells: 2.4, facet: 0.4, refract: 0.8, tilt: 0.6, concave: 0.35,
      bands: 3.6, shape: 0.05, warp: 1.1, width: 0.24, split: 0.15, core: 1.1, bevel: 0.6, sheen: 0.5,
      exposure: 1.1, react: 0.8, organic: 0.04, bleed: 0.55, reach: 0.09, edgeFlow: 0.6
    },
    speaking: {
      speed: 0.7, drift: 0.2, spin: 0.12, cells: 1.9, facet: 0.5, refract: 0.5, tilt: 0.4, concave: 0.2,
      bands: 5.5, shape: 0.85, warp: 0.9, width: 0.3, split: 0.14, core: 1.5, bevel: 0.45, sheen: 0.8,
      exposure: 1.2, react: 1.4, organic: 0.06, bleed: 0.75, reach: 0.11, edgeFlow: 0.9
    }
  },
  stateColors: {
    idle: { deep: "#010f08", base: "#1bd26a", hot: "#8ff2b8" },
    thinking: { deep: "#01100a", base: "#17cf8c", hot: "#a4f5dc" },
    speaking: { deep: "#02110b", base: "#2ee87c", hot: "#b6ffd2" }
  }
};

export type Orbsy23Props = Omit<ShaderOrbProps, "variant">;

export function Orbsy23({ size = 280, ...rest }: Orbsy23Props) {
  return <ShaderOrb variant={orbsy23Orb} size={size} {...rest} />;
}

export default Orbsy23;
