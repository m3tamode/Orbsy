/*
 * Orbsy 19 — Energy Contours. Original shader, MIT.
 * Not a "use client" module, so server components can read the variant as data.
 * The shader lives in a template literal: its comments must not contain backticks.
 */
import { ShaderOrb, type OrbVariant, type ShaderOrbProps } from "../core/orbkit-core";
import { ORBSY_GLSL } from "./orbsy-glsl";

/*
  A new take on orbsy-04 Contour in the fluoro-green set. The same isolines of
  3D fbm on a turning globe, but each contour is an electric filament: a thin
  white-hot core at constant pixel width (distance over a finite-difference
  gradient, as in orbsy-04) inside a wide soft glow measured in band units, so
  the lines read blurred, like neon tubes. A second, smoother field on the
  sphere acts as a coordinate along the lines: energy pulses travel on it,
  crackle flickers along it, and when speaking, jagged arcs jump across the
  bands at hashed cells of it. The bands between contours are glass terraces:
  each a slightly different depth, with a bevel highlight on its lit inner
  edge, and the luminous core behind them is refracted by a per-band offset
  along the gradient, so the ball reads as stacked glass lit from within.
*/
const ORBSY19_FRAG =
  ORBSY_GLSL +
  `
// Height (return) and the along-line coordinate g, both on the turning sphere.
float ecField(vec2 p, float R, out float g) {
  float r = length(p);
  float rc = min(r, R * 0.999);
  vec3 n = vec3(p * (rc / max(r, 1e-5)), sqrt(R * R - rc * rc)) / R;
  n.xz = orbsyRot(uP_spin) * n.xz;
  n.yz = orbsyRot(uP_tilt) * n.yz;
  g = noise3(n * 1.7 + vec3(3.7, 11.0, uP_speed * 0.5 + 9.0));
  return fbm3(n * uP_scale + vec3(0.0, 0.0, uP_speed));
}

void main() {
  vec2 uv = orbUV();
  float px = orbsyPx();
  float R = uP_radius * (1.0 + 0.03 * uOutput);
  float r = length(uv);
  // outside the rim every field is read at the rim; inside, at the pixel
  vec2 us = uv * (min(r, R * 0.995) / max(r, 1e-5));
  float mask = orbOrganicMask(uv, R, uP_organic, uP_edgeSoft, uP_edgeFlow);
  vec4 s = orbsySphere(us, R, px);

  float g;
  float gx;
  float gy;
  float h = ecField(us, R, g);
  float hx = ecField(us + vec2(px, 0.0), R, gx);
  float hy = ecField(us + vec2(0.0, px), R, gy);

  // ---- contours ----
  float L = uP_lines * (1.0 + 0.15 * uInput);
  float v = h * L;
  vec2 gv = vec2(hx - h, hy - h) * L;
  float dv = max(length(gv), 1e-5);
  vec2 gn = gv / dv;
  float idx = floor(v + 0.5);
  float f = abs(fract(v + 0.5) - 0.5);
  float dpx = f / dv;
  float major = 1.0 - step(0.5, mod(idx, 5.0));
  float hl = hash31(vec3(idx, 7.1, 3.3));

  float w = uP_width * mix(1.0, 1.8, major) * (1.0 + 0.5 * uOutput);
  float core = exp(-dpx * dpx / (w * w));
  float tube = exp(-dpx / (w * 5.0));
  float halo = exp(-f / max(uP_glow * mix(1.0, 1.5, major) * (1.0 + 0.3 * uOutput), 1e-3));

  // pulses run along the line: g is the along coordinate, direction per line
  float dir = hl > 0.5 ? 1.0 : -1.0;
  float ph = g * 26.0 * uP_pulses + hl * 6.2832 + dir * uP_pulse * (1.0 + hl);
  float pulse = pow(0.5 + 0.5 * sin(ph), 10.0);
  float crack = noise3(vec3(g * 60.0, idx * 3.1, uP_pulse * 7.0));
  float flick = mix(1.0, 0.25 + 1.5 * crack * crack, uP_crackle);

  // the limb compresses the bands, so the soft glow backs off there
  float limb = smoothstep(0.0, 0.55, s.z);
  // pixels read at the clamped rim would streak radially, so the lines end first
  float rimFade = smoothstep(0.1, 0.3, s.z);
  float lineE = (core * 1.25 + tube * 0.28 * mix(0.5, 1.0, limb) + halo * 0.12 * limb) * mix(0.55, 1.0, major);
  lineE *= mix(0.45, 1.0, limb) * rimFade;
  lineE *= flick * (1.0 + pulse * uP_pulseAmt * 2.2) * uP_bright * (1.0 + 0.35 * uOutput);

  // ---- glass terraces ----
  float band = floor(v);
  float bf = fract(v);
  float bh = hash31(vec3(band, 1.7, 9.2));
  vec2 ld = normalize(vec2(-0.55, 0.75));
  float lo = bf / dv;
  float up = (1.0 - bf) / dv;
  float bevel = exp(-lo / 7.0) * (0.5 + 0.5 * dot(-gn, ld)) + exp(-up / 7.0) * (0.5 + 0.5 * dot(gn, ld));
  float terrace = (0.02 + 0.13 * bh * bh + 0.05 * smoothstep(0.35, 0.75, h)) * mix(0.4, 1.0, limb);
  bevel *= limb * rimFade;

  // ---- interior energy, refracted through the terrace it sits behind ----
  vec2 cu = us + gn * (bf - 0.5) * 0.06 * uP_glass + (vec2(bh, hl) - 0.5) * 0.03 * uP_glass;
  float cr = length(cu) / R;
  float cf = fbm3(vec3(cu * 2.6, uP_speed * 0.8 + 21.0));
  float strand = 1.0 - abs(2.0 * cf - 1.0);
  float inner = exp(-cr * cr * 3.2) * (0.2 + 0.6 * cf) + pow(strand, 8.0) * 0.45 * exp(-cr * cr * 1.6);
  inner *= uP_core * mix(0.6, 1.0, bh) * (1.0 + 0.4 * uOutput);

  // ---- arcs leaping between neighbouring contours ----
  vec2 gg = vec2(gx - g, gy - g) * 6.0;
  float aa = g * 6.0 + band * 0.37;
  float ca = floor(aa);
  float ai = fract(aa);
  float da = max(length(gg), 1e-5);
  float live = step(1.0 - 0.2 * clamp(uP_arcs + uOutput * 0.8, 0.0, 1.5), hash31(vec3(ca, band, floor(uP_pulse * 2.5 + bh * 3.0))));
  // a jagged bolt: a few pixels of sideways jitter that changes across the band
  float jag = (noise3(vec3(bf * 9.0, ca * 1.3, uP_pulse * 9.0)) - 0.5) * 9.0;
  float apx = abs((ai - 0.5) / da - jag);
  float taper = smoothstep(0.0, 0.15, bf) * smoothstep(1.0, 0.85, bf);
  float arc = live * rimFade * (0.4 + taper) * (exp(-apx / 1.3) * 2.6 + exp(-apx / 6.0) * 0.5);

  float E = lineE + arc * uP_bright + inner + (terrace + bevel * 0.45) * uP_glass;

  // ---- organic edge: light bleeds from the local rim in patches ----
  float bl = orbBleed(uv, R, uP_reach, uP_edgeFlow);
  float blotch = mix(0.12, 1.0, smoothstep(0.38, 0.72, orbEdgeFbm(vec3(uv * 3.2, uP_edgeFlow * 0.45))));
  // outside, the rim's smooth height stands in for its brightness: sharp
  // line detail at the rim would smear into radial streaks
  float Eo = (0.25 + 0.55 * smoothstep(0.35, 0.7, h) + 0.3 * uOutput) * bl * blotch * uP_bleed * 0.5;
  float Et = E * mask + Eo * (1.0 - mask);

  vec3 col = orbsyFluoro(Et, uC_deep, uC_base, uC_hot) * smoothstep(0.0, 0.05, Et);
  col = orbsyBloomTone(col, 1.0);
  float a = clamp(max(col.r, max(col.g, col.b)) * 1.2, 0.0, 1.0);
  gl_FragColor = vec4(col, a);
}
`;

export const orbsy19Orb: OrbVariant = {
  key: "orbsy-19",
  label: "Energy Contours",
  note: "a new take on Orbsy 04: contours become glowing electric filaments over stacked glass terraces lit by an inner core",
  frag: ORBSY19_FRAG,
  params: [
    { key: "speed", label: "Terrain drift", min: 0, max: 3, step: 0.01, default: 0.1, integrate: true },
    { key: "spin", label: "Spin rate", min: 0, max: 2, step: 0.01, default: 0.06, integrate: true },
    { key: "pulse", label: "Pulse speed", min: 0, max: 6, step: 0.01, default: 0.6, integrate: true },
    { key: "tilt", label: "Axial tilt", min: -1.5, max: 1.5, step: 0.01, default: 0.4 },
    { key: "radius", label: "Radius", min: 0.3, max: 1, step: 0.01, default: 0.79 },
    { key: "scale", label: "Terrain scale", min: 0.5, max: 6, step: 0.05, default: 1.3 },
    { key: "lines", label: "Contour count", min: 3, max: 40, step: 0.5, default: 8 },
    { key: "width", label: "Core width (px)", min: 0.3, max: 4, step: 0.05, default: 1.2 },
    { key: "glow", label: "Glow spread", min: 0.01, max: 0.4, step: 0.005, default: 0.11 },
    { key: "bright", label: "Line energy", min: 0.2, max: 3, step: 0.01, default: 1.0 },
    { key: "pulses", label: "Pulse density", min: 0, max: 4, step: 0.05, default: 1.0 },
    { key: "pulseAmt", label: "Pulse strength", min: 0, max: 3, step: 0.01, default: 0.9 },
    { key: "crackle", label: "Crackle", min: 0, max: 1, step: 0.01, default: 0.35 },
    { key: "arcs", label: "Arcs", min: 0, max: 1.5, step: 0.01, default: 0 },
    { key: "glass", label: "Glass terraces", min: 0, max: 2, step: 0.01, default: 1 },
    { key: "core", label: "Inner energy", min: 0, max: 2, step: 0.01, default: 0.5 },
    { key: "organic", label: "Rim wander", min: 0, max: 0.15, step: 0.005, default: 0.035 },
    { key: "edgeSoft", label: "Rim feather", min: 0, max: 0.2, step: 0.005, default: 0.035 },
    { key: "bleed", label: "Energy bleed", min: 0, max: 3, step: 0.01, default: 0.9 },
    { key: "reach", label: "Bleed reach", min: 0.02, max: 0.5, step: 0.005, default: 0.1 },
    { key: "edgeFlow", label: "Edge flow", min: 0, max: 3, step: 0.01, default: 0.3, integrate: true }
  ],
  colors: [
    { key: "deep", label: "Deep", default: "#010f08" },
    { key: "base", label: "Fluoro", default: "#1bd26a" },
    { key: "hot", label: "Hot", default: "#8ff2b8" }
  ],
  statePresets: {
    // calm drift, slow pulses, gentle glow
    idle: {
      speed: 0.1, spin: 0.06, pulse: 0.6, scale: 1.3, lines: 8, width: 1.0, glow: 0.09, bright: 0.85,
      pulses: 1.0, pulseAmt: 1.0, crackle: 0.35, arcs: 0, glass: 0.85, core: 0.55, bleed: 0.9, reach: 0.1, edgeFlow: 0.3
    },
    // denser survey lines, fast pulses racing along them
    thinking: {
      speed: 0.35, spin: 0.2, pulse: 3.2, scale: 1.5, lines: 13, width: 1.0, glow: 0.08, bright: 1.05,
      pulses: 1.8, pulseAmt: 1.6, crackle: 0.5, arcs: 0.15, glass: 0.8, core: 0.55, bleed: 1.0, reach: 0.11, edgeFlow: 0.6
    },
    // lines surge thicker and brighter, arcs leap between neighbours
    speaking: {
      speed: 0.5, spin: 0.1, pulse: 1.8, scale: 1.2, lines: 7, width: 2.0, glow: 0.15, bright: 1.15,
      pulses: 1.2, pulseAmt: 0.8, crackle: 0.8, arcs: 1.0, glass: 0.9, core: 0.7, bleed: 1.5, reach: 0.15, edgeFlow: 1.0
    }
  },
  stateColors: {
    idle: { deep: "#010f08", base: "#1bd26a", hot: "#8ff2b8" },
    thinking: { deep: "#010f08", base: "#17cf8c", hot: "#a4f5dc" },
    speaking: { deep: "#01100a", base: "#2ee87c", hot: "#b6ffd2" }
  }
};

export type Orbsy19Props = Omit<ShaderOrbProps, "variant">;

export function Orbsy19({ size = 280, ...rest }: Orbsy19Props) {
  return <ShaderOrb variant={orbsy19Orb} size={size} {...rest} />;
}

export default Orbsy19;
