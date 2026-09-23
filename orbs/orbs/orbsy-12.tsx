/*
 * Orbsy 12 — Dither Globe. Original shader, MIT.
 * Not a "use client" module, so server components can read the variant as data.
 * The shader lives in a template literal: its comments must not contain backticks.
 */
import { ShaderOrb, type OrbVariant, type ShaderOrbProps } from "../core/orbkit-core";
import { ORBSY_GLSL } from "./orbsy-glsl";

/*
  A lit globe printed in glyphs. The ball is shaded once per screen cell:
  key light times a longitude-stretched 3D fbm, so the surface carries
  horizontal noise streaks that roll with the spin. That tone is quantized to
  the eight-step ASCII ramp with an 8x8 Bayer threshold across cells, so
  neighbouring cells alternate glyphs where the tone falls between steps, and
  each glyph is drawn as stacked horizontal strokes (the gaps between its
  bit rows are cut away), like reference 3.

  In between the glyphs a much finer pixel-pitch Bayer dither carries the
  same tone as dim dots, so the dark side still reads as a halftoned ball.
  The lit side burns white-hot through orbsyFluoro, the shadow side is deep
  green. A smooth glow of the light field fakes the bloom, and past the rim
  the bleed is itself dithered into sparse dots. Thinking sweeps a bright
  scan band across the latitudes; speaking lifts the light with the voice.
*/
const DITHER_FRAG =
  ORBSY_GLSL +
  `
void main() {
  vec2 uv = orbUV();
  float px = orbsyPx();
  float R = uP_radius * (1.0 + 0.035 * uOutput);
  float r = length(uv);
  vec2 fc = gl_FragCoord.xy;

  // Resolution-relative cells, wider than tall so glyphs read as strokes.
  float cw = max(min(uRes.x, uRes.y) / uP_cells, 4.0);
  vec2 cellSize = vec2(cw, cw * uP_aspect);
  vec2 cellIdx = floor(fc / cellSize);
  vec2 cellFc = (cellIdx + 0.5) * cellSize;
  vec2 cuv = (2.0 * cellFc - uRes) / min(uRes.x, uRes.y);
  vec2 p = fract(fc / cellSize) * 2.0 - 1.0;

  // Shade the ball at the cell centre.
  float cmask = orbOrganicMask(cuv, R, uP_organic, uP_edgeSoft, uP_edgeFlow);
  vec4 s = orbsySphere(orbRimUV(cuv, R), R, px);
  vec3 n = s.xyz;
  vec3 nr = n;
  nr.xz = orbsyRot(uP_spin) * nr.xz;
  vec3 q = vec3(nr.x, nr.y * uP_stretch, nr.z) * uP_scale;
  float streak = fbm3(q + vec3(0.0, 0.0, uP_speed * 0.4));
  streak = smoothstep(0.25, 0.8, streak);

  vec3 L = normalize(vec3(-0.5, 0.45, 0.74));
  float lam = clamp(dot(n, L), 0.0, 1.0);
  float light = uP_light * (0.85 + 0.6 * uOutput);
  float scan = exp(-pow((n.y - 0.85 * sin(uP_scanRate)) * 7.0, 2.0)) * uP_scan;
  float limb = 1.0 - n.z;
  float tone = lam * light * (0.2 + 1.1 * streak) + 0.08 * streak + scan * (0.4 + 0.6 * streak)
    + limb * limb * uP_rim * 0.5 + 0.12 * uInput;
  tone = clamp(tone, 0.0, 1.2);

  // Ordered dither across cells picks between neighbouring glyphs.
  float lvl = floor(min(tone, 1.0) * 8.0 + orbsyBayer8(cellIdx)) / 8.0;
  float glyph = orbsyAscii(lvl, p * 0.72);
  // Horizontal strokes: cut the gaps between the glyph's bit rows.
  float rowF = fract(p.y * 0.72 * 4.0 + 2.5);
  glyph *= step(rowF, uP_stroke);

  // Fine dither in the space between glyphs, at a few-pixel pitch.
  float pitch = max(uP_pitch * min(uRes.x, uRes.y) / 280.0, 1.0);
  // (the 1/128 offset keeps the zero Bayer cell dark at zero tone)
  float fine = step(orbsyBayer8(fc / pitch) + 0.008, tone * 0.6) * (1.0 - glyph);

  float e = glyph * (0.14 + lvl * lvl * 1.6 * uP_gain + max(tone - 1.0, 0.0) * 2.0)
    + fine * (0.05 + 0.2 * tone) * uP_fine;
  e *= step(0.5, cmask);

  // Bloom: a smooth, cell-free glow of the light on the ball itself.
  float mask = orbOrganicMask(uv, R, uP_organic, uP_edgeSoft, uP_edgeFlow);
  vec4 sp = orbsySphere(orbRimUV(uv, R), R, px);
  float glow = clamp(dot(sp.xyz, L), 0.0, 1.0);
  e += (glow * glow * 0.12 * light + 0.03) * uP_bloom * mask;

  // Gated so the canvas outside the ball stays truly black.
  vec3 col = orbsyFluoro(e, uC_deep, uC_base, uC_hot) * smoothstep(0.0, 0.04, e);

  /*
    Outside: the bleed dithered into dots on the same fine screen, broken up
    by a 2D screen-space field so it reads as drifting dust, not rays, over a
    soft halo that fakes the bloom spill.
  */
  float vol = uP_bleed * (0.7 + 0.6 * uOutput);
  float bleed = orbBleed(uv, R, uP_reach, uP_edgeFlow) * vol;
  float dustF = fbm(uv * 5.0 + vec2(0.0, uP_edgeFlow * 0.6));
  float dust = step(orbsyBayer8(fc / pitch) + 0.008, bleed * (0.08 + 1.0 * smoothstep(0.4, 0.8, dustF)));
  float halo = exp(-max(r - R, 0.0) / (0.07 * R)) * uP_bloom * 0.2 * (0.8 + 0.5 * uOutput);
  col += orbsyFluoro(0.3 + 0.35 * min(bleed, 1.0), uC_deep, uC_base, uC_hot) * (dust * 0.45 + halo) * (1.0 - mask);

  // Light CRT: scanlines only.
  col *= orbsyScanline(fc, max(min(uRes.x, uRes.y) / 160.0, 2.0), uP_crt);

  col = orbsyBloomTone(col, uP_exposure * (0.9 + 0.3 * uOutput));
  float a = clamp(max(col.r, max(col.g, col.b)) * 1.2, 0.0, 1.0);
  gl_FragColor = vec4(col, a);
}
`;

export const orbsy12Orb: OrbVariant = {
  key: "orbsy-12",
  label: "Dither Globe",
  note: "a lit, streaked globe printed as horizontal-stroke ASCII glyphs over a fine Bayer dither",
  frag: DITHER_FRAG,
  params: [
    { key: "speed", label: "Streak flow", min: 0, max: 3, step: 0.01, default: 0.3, integrate: true },
    { key: "spin", label: "Spin rate", min: 0, max: 2, step: 0.01, default: 0.1, integrate: true },
    { key: "scanRate", label: "Scan rate", min: 0, max: 4, step: 0.01, default: 0.4, integrate: true },
    { key: "radius", label: "Radius", min: 0.3, max: 1, step: 0.01, default: 0.78 },
    { key: "cells", label: "Glyph columns", min: 16, max: 80, step: 1, default: 30 },
    { key: "aspect", label: "Cell height", min: 0.5, max: 1.5, step: 0.01, default: 0.8 },
    { key: "stroke", label: "Stroke weight", min: 0.2, max: 1, step: 0.01, default: 0.45 },
    { key: "scale", label: "Streak scale", min: 0.5, max: 6, step: 0.05, default: 1.8 },
    { key: "stretch", label: "Streak stretch", min: 1, max: 12, step: 0.1, default: 5.0 },
    { key: "light", label: "Key light", min: 0, max: 2.5, step: 0.01, default: 1.2 },
    { key: "gain", label: "Glyph gain", min: 0, max: 3, step: 0.01, default: 1.0 },
    { key: "pitch", label: "Dither pitch", min: 1, max: 6, step: 0.1, default: 2.0 },
    { key: "fine", label: "Fine dither", min: 0, max: 2, step: 0.01, default: 1.0 },
    { key: "scan", label: "Scan band", min: 0, max: 1.5, step: 0.01, default: 0 },
    { key: "rim", label: "Rim light", min: 0, max: 2, step: 0.01, default: 0.5 },
    { key: "bloom", label: "Bloom", min: 0, max: 3, step: 0.01, default: 1.0 },
    { key: "crt", label: "Scanlines", min: 0, max: 1, step: 0.01, default: 0.2 },
    { key: "exposure", label: "Exposure", min: 0.3, max: 3, step: 0.01, default: 1.1 },
    { key: "organic", label: "Rim wander", min: 0, max: 0.15, step: 0.005, default: 0.04 },
    { key: "edgeSoft", label: "Rim feather", min: 0, max: 0.2, step: 0.005, default: 0.035 },
    { key: "bleed", label: "Energy bleed", min: 0, max: 3, step: 0.01, default: 0.9 },
    { key: "reach", label: "Bleed reach", min: 0.02, max: 0.5, step: 0.005, default: 0.12 },
    { key: "edgeFlow", label: "Edge flow", min: 0, max: 3, step: 0.01, default: 0.35, integrate: true }
  ],
  colors: [
    { key: "deep", label: "Deep", default: "#010d04" },
    { key: "base", label: "Fluoro", default: "#39ff14" },
    { key: "hot", label: "Hot", default: "#d6ff5c" }
  ],
  statePresets: {
    // a slow, calm globe: soft light, lazy streaks, no scan
    idle: {
      speed: 0.2, spin: 0.08, scanRate: 0.3, cells: 30, light: 1.2, gain: 0.9,
      scan: 0, bloom: 0.9, exposure: 1.0, organic: 0.035, bleed: 0.7, reach: 0.1, edgeFlow: 0.25
    },
    // scanning: finer glyph grid, fast streaks, a bright band sweeping the latitudes
    thinking: {
      speed: 0.8, spin: 0.35, scanRate: 1.6, cells: 38, light: 0.9, gain: 1.0,
      scan: 0.9, bloom: 1.0, exposure: 1.1, organic: 0.045, bleed: 1.0, reach: 0.12, edgeFlow: 0.8
    },
    // speaking: coarser, white-hot glyphs, heavy bloom, voice-driven light
    speaking: {
      speed: 0.6, spin: 0.15, scanRate: 0.6, cells: 26, light: 1.3, gain: 1.2,
      scan: 0.2, bloom: 1.5, exposure: 1.2, organic: 0.06, bleed: 1.5, reach: 0.15, edgeFlow: 1.1
    }
  },
  stateColors: {
    idle: { deep: "#010d04", base: "#39ff14", hot: "#d6ff5c" },
    thinking: { deep: "#010f07", base: "#2bff5a", hot: "#c4ffd0" },
    speaking: { deep: "#031002", base: "#5cff1f", hot: "#eaff80" }
  }
};

export type Orbsy12Props = Omit<ShaderOrbProps, "variant">;

export function Orbsy12({ size = 280, ...rest }: Orbsy12Props) {
  return <ShaderOrb variant={orbsy12Orb} size={size} {...rest} />;
}

export default Orbsy12;
