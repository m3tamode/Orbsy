/*
 * Orbsy 09 — Lattice. Original shader, MIT.
 * Not a "use client" module, so server components can read the variant as data.
 * The shader lives in a template literal: its comments must not contain backticks.
 */
import { ShaderOrb, type OrbVariant, type ShaderOrbProps } from "@/components/ui/orbkit-core";
import { ORBSY_GLSL } from "@/components/ui/orbsy-glsl";

/*
  A particle globe: dots laid out in latitude rings whose count per ring
  follows cos(latitude), so spacing stays even from equator to pole. Each
  pixel finds its nearest ring and dot analytically (3x3 neighbours, no
  loops over all particles). Dot size is driven by a blend of noise and a
  travelling latitude wave, so energy visibly ripples across the surface.
*/
const LATTICE_FRAG =
  ORBSY_GLSL +
  `
void main() {
  vec2 uv = orbUV();
  float px = orbsyPx();
  float R = uP_radius * (1.0 + uP_pulse * uOutput);
  vec4 s = orbsySphere(uv, R, px);

  vec3 n = s.xyz;
  n.yz = orbsyRot(uP_tilt) * n.yz;
  n.xz = orbsyRot(uP_spin) * n.xz;
  float lat = asin(clamp(n.y, -1.0, 1.0));
  float lon = atan(n.z, n.x);
  float dLat = PI / uP_rows;
  float row0 = floor((lat + PI * 0.5) / dLat);
  float pxW = px / R;

  vec3 col = vec3(0.0);
  float a = 0.0;
  for (int k = -1; k <= 1; k++) {
    float row = row0 + float(k);
    if (row < 0.0 || row > uP_rows - 1.0) continue;
    float la = -PI * 0.5 + (row + 0.5) * dLat;
    float cnt = max(1.0, floor(2.0 * uP_rows * cos(la) + 0.5));
    float dLon = TAU / cnt;
    float j0 = floor(lon / dLon + 0.5);
    for (int m = -1; m <= 1; m++) {
      float lo = (j0 + float(m)) * dLon;
      vec3 dp = vec3(cos(la) * cos(lo), sin(la), cos(la) * sin(lo));
      float fv = fbm3(dp * uP_scale + vec3(0.0, uP_speed, 0.0));
      float wave = 0.5 + 0.5 * sin(dp.y * uP_waveFreq - uP_wave);
      float e = clamp(mix(smoothstep(0.25, 0.75, fv), wave, uP_waveMix) * uP_gain * (1.0 + 0.5 * uInput), 0.0, 1.0);
      float rad = dLat * uP_dot * (0.25 + 0.75 * e);
      float mm = 1.0 - smoothstep(rad - pxW, rad + pxW, length(n - dp));
      col = max(col, mix(uC_low, uC_high, e) * mm);
      a = max(a, mm);
    }
  }

  float shade = mix(0.35, 1.0, s.z);
  gl_FragColor = vec4(col * shade * s.w, a * s.w);
}
`;

export const orbsy09Orb: OrbVariant = {
  key: "orbsy-09",
  label: "Lattice",
  note: "an evenly spaced particle globe with energy rippling across its dots",
  frag: LATTICE_FRAG,
  params: [
    { key: "speed", label: "Field speed", min: 0, max: 3, step: 0.01, default: 0.25, integrate: true },
    { key: "spin", label: "Spin rate", min: 0, max: 2, step: 0.01, default: 0.15, integrate: true },
    { key: "wave", label: "Wave speed", min: 0, max: 6, step: 0.01, default: 0.8, integrate: true },
    { key: "radius", label: "Radius", min: 0.3, max: 1, step: 0.01, default: 0.86 },
    { key: "pulse", label: "Voice pulse", min: 0, max: 0.3, step: 0.005, default: 0.05 },
    { key: "tilt", label: "Axial tilt", min: -1.5, max: 1.5, step: 0.01, default: 0.35 },
    { key: "rows", label: "Latitude rings", min: 6, max: 48, step: 1, default: 22 },
    { key: "dot", label: "Dot size", min: 0.1, max: 0.7, step: 0.005, default: 0.42 },
    { key: "scale", label: "Noise scale", min: 0.5, max: 6, step: 0.05, default: 2.0 },
    { key: "waveFreq", label: "Wave frequency", min: 1, max: 24, step: 0.1, default: 8.0 },
    { key: "waveMix", label: "Wave vs noise", min: 0, max: 1, step: 0.01, default: 0.3 },
    { key: "gain", label: "Energy gain", min: 0.3, max: 2.5, step: 0.01, default: 1.1 }
  ],
  colors: [
    { key: "low", label: "Resting dot", default: "#3a2bff" },
    { key: "high", label: "Energised dot", default: "#7fffd4" }
  ],
  statePresets: {
    idle: { speed: 0.25, spin: 0.15, wave: 0.8, rows: 22, dot: 0.42, waveMix: 0.3, gain: 1.1 },
    // denser globe, rapid scanning wave
    thinking: { speed: 0.5, spin: 0.5, wave: 2.0, rows: 30, dot: 0.38, waveMix: 0.7, gain: 1.1 },
    // fat dots pulsing outward with the voice
    speaking: { speed: 0.8, spin: 0.2, wave: 3.0, rows: 20, dot: 0.5, waveMix: 0.55, gain: 1.35 }
  },
  stateColors: {
    idle: { low: "#3a2bff", high: "#7fffd4" },
    thinking: { low: "#00796b", high: "#e0f7fa" },
    speaking: { low: "#ff1744", high: "#ffea00" }
  }
};

export type Orbsy09Props = Omit<ShaderOrbProps, "variant">;

export function Orbsy09({ size = 280, ...rest }: Orbsy09Props) {
  return <ShaderOrb variant={orbsy09Orb} size={size} {...rest} />;
}

export default Orbsy09;
