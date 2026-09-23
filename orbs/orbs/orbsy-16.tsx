/*
 * Orbsy 16 — Grid Tunnel. Original shader, MIT.
 * Not a "use client" module, so server components can read the variant as data.
 * The shader lives in a template literal: its comments must not contain backticks.
 */
import { ShaderOrb, type OrbVariant, type ShaderOrbProps } from "../core/orbkit-core";
import { ORBSY_GLSL } from "./orbsy-glsl";

/*
  Looking down an endless square corridor inside the ball. Screen space is
  mapped to the tunnel with the Chebyshev radius m = max(|x|, |y|): depth is
  1 / m, and the cross coordinate along each wall is the other axis over m.
  Integer depths are square frames; each wall between two frames is cut into
  cells, and a hash per cell picks how many more times it is subdivided, so
  the grid is recursive and changes as frames arrive.

  - MOTION: the zoom clock is added to the depth coordinate before floor and
    fract, so frames flow toward the viewer forever with no seam. Pulses are
    a sawtooth over the frame index on a second clock, a bright head frame
    running outward with a trail behind it.
  - LIGHT: line brightness climbs with depth and the frames converge into a
    white-hot vanishing point. Where frames get closer than a few pixels the
    line coverage fades to its average, so the centre blooms instead of
    aliasing. Lit cells are ordered-dithered on a dot screen.
  - CRT: a mild barrel, scanlines, an aperture-grille mask and a roll bar.
    Past the rim the same tunnel keeps going, shown only through the bleed
    and a screen-space patch field, so light escapes where frames are hot.
*/
const ORBSY16_FRAG =
  ORBSY_GLSL +
  `
float gtLine(float d, float w) {
  return 1.0 - smoothstep(w * 0.5, w * 0.5 + 1.0, d);
}

// Tunnel energy at screen point p (in units of the ball radius). pxu is one
// pixel in the same units. Returns line energy (x), dithered fill energy (y),
// bloom (z).
vec3 gtTunnel(vec2 p, float pxu) {
  // twist with log radius: a slow corkscrew, not a clock
  p = orbsyRot(uP_twist * log(max(length(p), 1e-3))) * p;
  vec2 a = abs(p);
  float m = max(max(a.x, a.y), 1e-3);
  float z = 1.0 / m;
  float Z = z * uP_freq + uP_zoom;
  float k = floor(Z);
  float fz = fract(Z);
  float pz = uP_freq * pxu / (m * m);

  bool xw = a.x > a.y;
  float u = (xw ? p.y : p.x) / m;
  float wall = xw ? (p.x > 0.0 ? 0.0 : 1.0) : (p.y > 0.0 ? 2.0 : 3.0);
  float N = floor(uP_cells + 0.5);
  float cu = (u + 1.0) * 0.5 * N;
  float ci = floor(cu);
  float pu = pxu / m * 0.5 * N;

  float w = uP_lineW;
  // frames: fade to their average once closer than a few pixels
  float frameMix = smoothstep(2.0, 7.0, 1.0 / pz);
  float frame = mix(min(w / max(1.0 / pz, 1e-3), 1.0), gtLine(min(fz, 1.0 - fz) / pz, w), frameMix);
  float cellL = gtLine(min(fract(cu), 1.0 - fract(cu)) / pu, w * 0.75) * frameMix;

  // recursive subdivision per cell, reseeded as frames arrive
  vec3 cid = vec3(k, ci + wall * 17.0, 3.0);
  float h = hash31(cid);
  float g = h < uP_recurse * 0.45 ? 4.0 : (h < uP_recurse ? 2.0 : 1.0);
  float su = fract(cu) * g;
  float sz = fz * g;
  float subL = g > 1.0 ? max(
    gtLine(min(fract(su), 1.0 - fract(su)) / (pu * g), w * 0.6),
    gtLine(min(fract(sz), 1.0 - fract(sz)) / (pz * g), w * 0.6)) : 0.0;
  subL *= smoothstep(3.0, 8.0, 1.0 / (pz * g));

  // wall seams: the corridor's four corner edges
  float seam = gtLine(abs(a.x - a.y) / (pxu * 1.41), w) * smoothstep(0.02, 0.1, m);

  // pulses: sawtooth over frame index, the head running toward the viewer
  float ph = fract((k + uP_pulseClock) / uP_period);
  float pulse = pow(1.0 - ph, 5.0) * uP_pulse * (1.0 + uP_react * (2.2 * uOutput + 0.5 * uInput));

  // lit cells, at the subdivided resolution, on a stepped flicker clock
  vec3 sid = vec3(k * 7.0 + floor(sz), (ci + wall * 17.0) * 5.0 + floor(su), floor(uP_flicker + h * 5.0));
  float on = step(hash31(sid), uP_density);
  float fillE = on * (0.22 + 0.9 * pulse) * mix(0.6, 1.0, hash31(sid + 9.0));
  fillE += pulse * 0.12;

  float depthL = mix(0.45, 1.5, smoothstep(0.95, 0.12, m));
  float lines = frame * (0.6 + 1.6 * pulse) + cellL * (0.4 + 0.8 * pulse) + subL * 0.35 + seam * 0.75;
  // white-hot vanishing point
  float core = uP_core * (0.012 / (m * m + 0.012)) * (1.0 + 0.8 * uP_react * uOutput);
  float bloom = pulse * 0.25 + core * 0.6 + frame * 0.1;
  return vec3(lines * depthL + core, fillE * depthL, bloom);
}

void main() {
  vec2 uv = orbUV();
  float px = orbsyPx();
  vec2 fc = orbFragCoord(uv);
  float R = uP_radius * (1.0 + 0.03 * uP_react * uOutput);
  float r = length(uv);

  float mask = orbOrganicMask(uv, R, uP_organic, uP_edgeSoft, uP_edgeFlow);
  vec2 q = orbsyBarrel(uv / R, 0.12 * uP_crt);
  q = orbsyRot(uP_spin) * q;
  vec3 T = gtTunnel(q, px / R);

  // ordered dither on a dot screen for the lit cells
  float bay = orbsyBayer8(floor(fc * 0.5));
  float lv = 4.0;
  float fd = floor(T.y * lv + bay) / lv;
  float dots = 1.0 - smoothstep(0.25, 0.5, length(fract(fc / 3.0) - 0.5));
  float fillE = mix(T.y, fd * (0.5 + 0.75 * dots), uP_dither);

  float E = (T.x + fillE) * uP_bright;
  vec3 col = orbsyFluoro(E, uC_deep, uC_base, uC_hot);
  col += uC_base * T.z * uP_bloom * 0.5;

  // past the rim the tunnel continues, seen only through the bleed
  float rimPatch = smoothstep(0.38, 0.72, orbEdgeFbm(vec3(uv * 3.2, uP_edgeFlow * 0.45)));
  float bl = orbBleed(uv, R, uP_reach, uP_edgeFlow) * uP_bleed * (0.7 + 0.6 * uOutput);
  float oe = smoothstep(0.3, 1.6, E + T.z * uP_bloom);
  vec3 outer = orbsyFluoro(E * 0.8, uC_deep, uC_base, uC_hot) * bl * oe * mix(0.1, 1.0, rimPatch);
  col = col * mask + outer * (1.0 - mask);

  // CRT
  float crt = uP_crt;
  col *= orbsyScanline(fc, 3.0, 0.5 * crt);
  col *= orbsyPhosphorMask(fc, 0.35 * crt);
  col += uC_base * orbsyRollBar(uv, uP_zoom * 0.5) * 0.1 * crt * mask;

  col = orbsyBloomTone(col, uP_exposure);
  gl_FragColor = vec4(col, clamp(max(col.r, max(col.g, col.b)) * 1.2, 0.0, 1.0));
}
`;

export const orbsy16Orb: OrbVariant = {
  key: "orbsy-16",
  label: "Grid Tunnel",
  note: "an endless corridor of nested square frames, recursively subdivided, zooming toward you with pulses racing out of a white-hot vanishing point, dithered on a CRT",
  frag: ORBSY16_FRAG,
  params: [
    { key: "zoom", label: "Zoom speed", min: 0, max: 4, step: 0.01, default: 0.5, integrate: true },
    { key: "pulseClock", label: "Pulse speed", min: 0, max: 12, step: 0.05, default: 2.0, integrate: true },
    { key: "spin", label: "Roll rate", min: 0, max: 2, step: 0.01, default: 0.03, integrate: true },
    { key: "flicker", label: "Cell flicker", min: 0, max: 12, step: 0.05, default: 1.0, integrate: true },
    { key: "radius", label: "Radius", min: 0.3, max: 1, step: 0.01, default: 0.79 },
    { key: "freq", label: "Frame density", min: 0.3, max: 3, step: 0.01, default: 1.5 },
    { key: "cells", label: "Cells per wall", min: 2, max: 12, step: 1, default: 6 },
    { key: "recurse", label: "Recursion", min: 0, max: 1, step: 0.01, default: 0.5 },
    { key: "density", label: "Lit cells", min: 0, max: 1, step: 0.01, default: 0.2 },
    { key: "period", label: "Pulse spacing", min: 2, max: 16, step: 0.5, default: 7 },
    { key: "pulse", label: "Pulse energy", min: 0, max: 3, step: 0.01, default: 0.8 },
    { key: "twist", label: "Twist", min: -1, max: 1, step: 0.01, default: 0 },
    { key: "core", label: "Vanishing glow", min: 0, max: 4, step: 0.01, default: 1.2 },
    { key: "lineW", label: "Line width", min: 0.5, max: 4, step: 0.05, default: 1.6 },
    { key: "bright", label: "Brightness", min: 0.2, max: 3, step: 0.01, default: 1.0 },
    { key: "dither", label: "Dither screen", min: 0, max: 1, step: 0.01, default: 0.7 },
    { key: "bloom", label: "Bloom", min: 0, max: 2, step: 0.01, default: 0.7 },
    { key: "crt", label: "CRT", min: 0, max: 1, step: 0.01, default: 0.7 },
    { key: "exposure", label: "Exposure", min: 0.3, max: 3, step: 0.01, default: 1.1 },
    { key: "react", label: "Voice react", min: 0, max: 2, step: 0.01, default: 1.0 },
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
    // slow drift down a plain corridor, rare pulses, few lit cells
    idle: {
      zoom: 0.35, pulseClock: 1.2, spin: 0.02, flicker: 0.6, freq: 1.5, recurse: 0.35, density: 0.12,
      period: 9, pulse: 0.7, twist: 0, core: 1.0, bright: 0.95, dither: 0.7, bloom: 0.6, crt: 0.65,
      react: 0.8, organic: 0.03, bleed: 0.7, reach: 0.09, edgeFlow: 0.25
    },
    // racing: fast zoom, a corkscrew twist, dense recursion and quick pulses
    thinking: {
      zoom: 1.6, pulseClock: 6.0, spin: 0.12, flicker: 5.0, freq: 1.8, recurse: 0.85, density: 0.3,
      period: 4, pulse: 0.9, twist: 0.35, core: 1.1, bright: 1.05, dither: 0.8, bloom: 0.7, crt: 0.85,
      react: 0.8, organic: 0.05, bleed: 1.0, reach: 0.11, edgeFlow: 0.8
    },
    // brightest: the vanishing point flares, pulses swell with the voice
    speaking: {
      zoom: 0.8, pulseClock: 3.5, spin: 0.04, flicker: 2.0, freq: 1.2, recurse: 0.5, density: 0.35,
      period: 6, pulse: 1.3, twist: 0, core: 2.0, bright: 1.25, dither: 0.6, bloom: 0.95, crt: 0.6,
      react: 1.4, organic: 0.07, bleed: 1.5, reach: 0.14, edgeFlow: 1.0
    }
  },
  stateColors: {
    idle: { deep: "#010d04", base: "#39ff14", hot: "#d6ff5c" },
    thinking: { deep: "#01100a", base: "#2bff6a", hot: "#c4ffd0" },
    speaking: { deep: "#030f02", base: "#5cff1f", hot: "#eaff80" }
  }
};

export type Orbsy16Props = Omit<ShaderOrbProps, "variant">;

export function Orbsy16({ size = 280, ...rest }: Orbsy16Props) {
  return <ShaderOrb variant={orbsy16Orb} size={size} {...rest} />;
}

export default Orbsy16;
