/*
 * Orbsy 11 — Glyph Shells. Original shader, MIT.
 * Not a "use client" module, so server components can read the variant as data.
 * The shader lives in a template literal: its comments must not contain backticks.
 */
import { ShaderOrb, type OrbVariant, type ShaderOrbProps } from "@/components/ui/orbkit-core";
import { ORBSY_GLSL } from "@/components/ui/orbsy-glsl";

/*
  ASCII in depth. Four nested concentric spheres of glyphs sit inside the
  ball. Each view ray is intersected with every shell analytically (front and
  back hit), and each hit is looked up in that shell's own rotated frame, so
  the shells turn about different axes at different speeds and the characters
  slide past each other with real parallax. Every shell is cut into cube-face
  cells (orbsyCubeUV) scaled with its radius so the glyphs keep one size, and
  each cell draws the orbsyAscii glyph picked by a streaming 3D noise sampled
  at the cell centre.

  Hits are composited front to back as additive light with a little
  transmission loss behind each lit glyph, so you read characters through
  characters. Inner shells are smaller, dimmer and greener; back hits are
  dimmer still. A travelling energy band sweeps the outer shells: where it
  peaks the glyphs jump up the density ramp and burn white-hot, each with a
  soft cell glow for bloom. Voice lifts the band and the gain.

  A CRT sits on top: barrel curvature, scanlines, an aperture grille and a
  roll bar. Past the rim, sparse screen-space glyph sparks escape where the
  band is hot at the edge, patched by edge noise so no ring is drawn.
*/
const GLYPH_SHELLS_FRAG =
  ORBSY_GLSL +
  `
// Direction of a point on a cube face (inverse of orbsyCubeUV, unnormalised).
vec3 shellCubeDir(vec2 f, float face) {
  if (face < 0.5) return vec3(1.0, f.y, f.x);
  if (face < 1.5) return vec3(-1.0, f.y, -f.x);
  if (face < 2.5) return vec3(f.x, 1.0, f.y);
  if (face < 3.5) return vec3(f.x, -1.0, -f.y);
  if (face < 4.5) return vec3(-f.x, f.y, 1.0);
  return vec3(f.x, f.y, -1.0);
}

// Frame of shell k: two rotations whose angles are phases of the spin clock.
vec3 shellFrame(vec3 p, float k, float spin) {
  float a = spin * mix(0.6, 1.7, fract(k * 0.618 + 0.2)) * (mod(k, 2.0) < 0.5 ? 1.0 : -1.0) + k * 1.9;
  float b = 0.35 + k * 0.7;
  p.yz = orbsyRot(b) * p.yz;
  p.xz = orbsyRot(a) * p.xz;
  p.xy = orbsyRot(k * 0.9 + 0.3) * p.xy;
  return p;
}

// The travelling energy: planes sweeping back and forth through the whole
// stack in world space, so each lights a ring on every shell it crosses.
float shellWave(vec3 w, float phase) {
  vec3 ax1 = normalize(vec3(0.3, 1.0, 0.2 * sin(phase * 0.3)));
  vec3 ax2 = normalize(vec3(1.0, -0.25, 0.4));
  float d1 = dot(w, ax1) - sin(phase) * 1.05;
  float d2 = dot(w, ax2) - sin(phase * 0.77 + 2.0) * 1.05;
  float wd = uP_bandWidth;
  return exp(-d1 * d1 / (wd * wd)) + uP_sweeps * exp(-d2 * d2 / (wd * wd));
}

// One shell hit. w: world hit point (unit radius), k: shell index, cells: cells
// per cube face. Returns (glyph light, soft glow, coverage).
vec3 shellHit(vec3 w, float k, float cells, float facing, float sr) {
  vec3 q = shellFrame(w, k, uP_spin);
  vec3 cu = orbsyCubeUV(q);
  vec2 g = (cu.xy * 0.5 + 0.5) * cells;
  vec2 id = floor(g);
  vec2 p = fract(g) * 2.0 - 1.0;
  p *= 1.18; // a gap between characters
  vec2 fc = (id + 0.5) / cells * 2.0 - 1.0;
  vec3 c = normalize(shellCubeDir(fc, cu.z));
  float h = hash31(vec3(id, cu.z * 7.0 + k * 31.0));

  // Streaming field: the stream clock only translates a separate noise axis.
  float f = noise3(c * uP_scale + vec3(k * 5.3, 0.0, uP_stream));
  f = f * 0.7 + 0.3 * noise3(c * uP_scale * 2.3 + vec3(0.0, uP_stream * 1.7, k * 3.1));
  // Stepped character churn per cell.
  float churn = hash31(vec3(id, floor(uP_stream * 3.0 + h * 5.0) + k));
  float outer = step(k, 0.5);
  // The outer shell is denser and more contrasty than the ones inside it.
  float level = clamp((f - 0.52 + uP_density + outer * 0.08) * mix(2.6, 3.4, outer) + (churn - 0.5) * 0.3, 0.0, 1.0);
  level *= step(0.12, level);
  // Empty cells on the outer shell keep a dim dot so the ball stays round.
  level = max(level, outer * 0.1);
  // A sprinkle of resting hot cells on the outer shell, on the churn clock.
  float spark = outer * step(1.0 - uP_sparkle, hash31(vec3(id, floor(uP_stream * 2.0 + h * 9.0) + 17.0))) * step(0.2, level);

  // Energy band, measured at the cell centre in world space.
  vec3 cw = c;
  cw.xy = orbsyRot(-(k * 0.9 + 0.3)) * cw.xy;
  cw.xz = orbsyRot(-(uP_spin * mix(0.6, 1.7, fract(k * 0.618 + 0.2)) * (mod(k, 2.0) < 0.5 ? 1.0 : -1.0) + k * 1.9)) * cw.xz;
  cw.yz = orbsyRot(-(0.35 + k * 0.7)) * cw.yz;
  float wave = min(shellWave(cw * sr, uP_band), 1.2) * (1.0 + 0.6 * uOutput);
  float lv = clamp(max(level, wave * (0.75 + 0.3 * churn)), 0.0, 0.99);
  float gl = orbsyAscii(lv, p) * step(0.09, lv);
  float gs = 1.0 - smoothstep(0.0, 1.0, length(p / 1.18));
  gs *= gs;
  float fade = smoothstep(0.05, 0.35, facing);
  float e = gl * ((0.35 + 0.7 * level) * mix(1.0, uP_outer, outer) + spark * 0.9 + wave * wave * uP_burn * 1.6) * fade;
  float soft = gs * (wave + 0.3 * level) * lv * fade;
  return vec3(e, soft, gl * fade * min(lv * 1.5, 1.0));
}

void main() {
  vec2 uv0 = orbUV();
  vec2 uv = orbsyBarrel(uv0, uP_curve);
  float px = orbsyPx();
  float R = uP_radius * (1.0 + 0.03 * uOutput);
  float r = length(uv);
  vec2 fc = gl_FragCoord.xy;

  float mask = orbOrganicMask(uv, R, uP_organic, uP_edgeSoft, uP_edgeFlow);
  vec2 ruv = uv / R;
  float rr = dot(ruv, ruv);

  vec3 acc = vec3(0.0); // (light, glow, unused)
  float T = 1.0;
  // Front hits, outermost shell first.
  for (int i = 0; i < 4; i++) {
    float k = float(i);
    float sr = 1.0 - k * uP_gap;
    float d2 = sr * sr - rr;
    if (d2 > 0.0) {
      float z = sqrt(d2);
      vec3 w = vec3(ruv, z) / sr;
      float dim = pow(uP_falloff, k);
      vec3 hv = shellHit(w, k, floor(uP_cells * sr + 0.5), w.z, sr);
      acc.x += hv.x * dim * T;
      acc.y += hv.y * dim * T * (k < 1.5 ? 1.0 : 0.5);
      T *= 1.0 - uP_occlude * hv.z;
    }
  }
  // Back hits, innermost first (continuing further from the eye).
  for (int i = 3; i >= 0; i--) {
    float k = float(i);
    float sr = 1.0 - k * uP_gap;
    float d2 = sr * sr - rr;
    if (d2 > 0.0) {
      float z = -sqrt(d2);
      vec3 w = vec3(ruv, z) / sr;
      float dim = pow(uP_falloff, k) * uP_back;
      vec3 hv = shellHit(w, k, floor(uP_cells * sr + 0.5), -w.z, sr);
      acc.x += hv.x * dim * T;
      acc.y += hv.y * dim * T * 0.5;
      T *= 1.0 - uP_occlude * hv.z;
    }
  }

  float gain = uP_gain * (0.85 + 0.5 * uOutput);
  float E = acc.x * gain;
  vec3 col = orbsyFluoro(E, uC_deep, uC_base, uC_hot) * step(0.001, E);
  // Inner light is greener: a touch of the base hue on the dim end.
  col += uC_base * acc.y * uP_bloom * 0.35;
  col *= mask;

  // Escaping glyph sparks past the rim, only where the edge content is hot.
  float cellPx = R * 2.0 / uP_cells;
  vec2 sg = uv / cellPx;
  vec2 sid = floor(sg);
  vec2 sp = fract(sg) * 2.0 - 1.0;
  float sh = hash31(vec3(sid, floor(uP_edgeFlow * 3.0)));
  float edgeHot = clamp(acc.x * gain * 0.8 + acc.y * 0.8, 0.0, 1.5);
  float pf = mix(0.12, 1.0, smoothstep(0.38, 0.72, orbEdgeFbm(vec3(uv * 3.2, uP_edgeFlow * 0.45))));
  float bl = orbBleed(uv, R, uP_reach, uP_edgeFlow) * uP_bleed * (0.7 + 0.6 * uOutput) * pf * edgeHot;
  float spark = orbsyAscii(0.15 + 0.7 * sh, sp * 1.15) * step(0.35, sh) * step(0.05, r - R + 0.02);
  float oe = spark * bl * 1.4 + bl * 0.08;
  col += orbsyFluoro(oe, uC_deep, uC_base, uC_hot) * min(oe * 2.0, 1.0) * (1.0 - mask);

  // CRT on the unbent screen.
  float pitch = max(min(uRes.x, uRes.y) / 160.0, 2.0);
  col *= orbsyScanline(fc, pitch, uP_scan);
  col *= orbsyPhosphorMask(fc, uP_mask);
  col *= 1.0 + orbsyRollBar(uv0, uP_stream) * uP_roll;
  col *= 1.0 - smoothstep(0.9, 1.0, max(abs(uv.x), abs(uv.y)));

  col = orbsyBloomTone(col, uP_exposure);
  float a = clamp(max(col.r, max(col.g, col.b)) * 1.2, 0.0, 1.0);
  gl_FragColor = vec4(col, a);
}
`;

export const orbsy11Orb: OrbVariant = {
  key: "orbsy-11",
  label: "Glyph Shells",
  note: "four nested ray-traced spheres of ASCII glyphs turning on different axes, a white-hot energy band and a CRT",
  frag: GLYPH_SHELLS_FRAG,
  params: [
    { key: "stream", label: "Glyph stream", min: 0, max: 3, step: 0.01, default: 0.35, integrate: true },
    { key: "spin", label: "Shell spin", min: 0, max: 2, step: 0.01, default: 0.15, integrate: true },
    { key: "band", label: "Band speed", min: 0, max: 3, step: 0.01, default: 0.4, integrate: true },
    { key: "radius", label: "Radius", min: 0.3, max: 1, step: 0.01, default: 0.79 },
    { key: "cells", label: "Glyphs per face", min: 4, max: 20, step: 1, default: 9 },
    { key: "gap", label: "Shell spacing", min: 0.1, max: 0.24, step: 0.005, default: 0.2 },
    { key: "scale", label: "Field scale", min: 0.5, max: 6, step: 0.05, default: 2.0 },
    { key: "density", label: "Glyph density", min: -0.4, max: 0.4, step: 0.01, default: 0.0 },
    { key: "outer", label: "Outer shell gain", min: 0.5, max: 3, step: 0.01, default: 1.7 },
    { key: "sparkle", label: "Hot glyphs", min: 0, max: 0.5, step: 0.01, default: 0.12 },
    { key: "falloff", label: "Inner dimming", min: 0.2, max: 1, step: 0.01, default: 0.6 },
    { key: "back", label: "Back shells", min: 0, max: 1, step: 0.01, default: 0.4 },
    { key: "occlude", label: "Glyph occlusion", min: 0, max: 0.9, step: 0.01, default: 0.35 },
    { key: "gain", label: "Glyph gain", min: 0, max: 3, step: 0.01, default: 1.0 },
    { key: "burn", label: "Band burn", min: 0, max: 3, step: 0.01, default: 1.3 },
    { key: "bandWidth", label: "Band width", min: 0.03, max: 0.5, step: 0.005, default: 0.14 },
    { key: "sweeps", label: "Second sweep", min: 0, max: 1, step: 0.01, default: 0.3 },
    { key: "bloom", label: "Bloom", min: 0, max: 3, step: 0.01, default: 1.0 },
    { key: "curve", label: "CRT curvature", min: 0, max: 0.4, step: 0.005, default: 0.1 },
    { key: "scan", label: "Scanlines", min: 0, max: 1, step: 0.01, default: 0.35 },
    { key: "mask", label: "Phosphor mask", min: 0, max: 1, step: 0.01, default: 0.3 },
    { key: "roll", label: "Roll bar", min: 0, max: 1.5, step: 0.01, default: 0.3 },
    { key: "exposure", label: "Exposure", min: 0.3, max: 3, step: 0.01, default: 1.1 },
    { key: "organic", label: "Rim wander", min: 0, max: 0.15, step: 0.005, default: 0.035 },
    { key: "edgeSoft", label: "Rim feather", min: 0, max: 0.2, step: 0.005, default: 0.03 },
    { key: "bleed", label: "Energy bleed", min: 0, max: 3, step: 0.01, default: 1.0 },
    { key: "reach", label: "Bleed reach", min: 0.02, max: 0.5, step: 0.005, default: 0.12 },
    { key: "edgeFlow", label: "Edge flow", min: 0, max: 3, step: 0.01, default: 0.35, integrate: true }
  ],
  colors: [
    { key: "deep", label: "Deep", default: "#010d04" },
    { key: "base", label: "Fluoro", default: "#39ff14" },
    { key: "hot", label: "Hot", default: "#d6ff5c" }
  ],
  statePresets: {
    idle: {
      stream: 0.25, spin: 0.12, band: 0.3, cells: 9, density: 0.05, outer: 1.7, sparkle: 0.1, falloff: 0.5, back: 0.35,
      gain: 1.25, burn: 1.3, bandWidth: 0.16, sweeps: 0.0, bloom: 0.8, roll: 0.2, scan: 0.3,
      exposure: 1.0, organic: 0.03, bleed: 0.8, reach: 0.1, edgeFlow: 0.25
    },
    thinking: {
      stream: 1.1, spin: 0.55, band: 1.4, cells: 10, density: 0.04, outer: 1.5, sparkle: 0.14, falloff: 0.55, back: 0.4,
      gain: 1.15, burn: 1.4, bandWidth: 0.1, sweeps: 1.0, bloom: 0.9, roll: 0.7, scan: 0.45,
      exposure: 1.1, organic: 0.045, bleed: 1.0, reach: 0.12, edgeFlow: 0.8
    },
    speaking: {
      stream: 0.8, spin: 0.25, band: 0.9, cells: 8, density: 0.08, outer: 1.6, sparkle: 0.2, falloff: 0.6, back: 0.45,
      gain: 1.3, burn: 1.7, bandWidth: 0.18, sweeps: 0.5, bloom: 1.1, roll: 0.35, scan: 0.35,
      exposure: 1.3, organic: 0.06, bleed: 1.6, reach: 0.16, edgeFlow: 1.1
    }
  },
  stateColors: {
    idle: { deep: "#010d04", base: "#39ff14", hot: "#d6ff5c" },
    thinking: { deep: "#010f07", base: "#2bff6a", hot: "#c4ffd0" },
    speaking: { deep: "#031002", base: "#5cff1f", hot: "#eaff80" }
  }
};

export type Orbsy11Props = Omit<ShaderOrbProps, "variant">;

export function Orbsy11({ size = 280, ...rest }: Orbsy11Props) {
  return <ShaderOrb variant={orbsy11Orb} size={size} {...rest} />;
}

export default Orbsy11;
