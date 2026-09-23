/*
 * Orbsy 01 — Halftone. Original shader, MIT.
 * Not a "use client" module, so server components can read the variant as data.
 * The shader lives in a template literal: its comments must not contain backticks.
 */
import { ShaderOrb, type OrbVariant, type ShaderOrbProps } from "@/components/ui/orbkit-core";
import { ORBSY_GLSL } from "@/components/ui/orbsy-glsl";

/*
  A lit, noise-streaked sphere printed through a rotated dot screen. Each
  screen cell samples the sphere once at its centre and draws one dot whose
  area follows that tone, so the ball reads as a print rather than a render.
  Neighbouring cells are checked too, so large dots can overlap their cell.
*/
const HALFTONE_FRAG =
  ORBSY_GLSL +
  `
float halftoneTone(vec2 p, float R) {
  float r = length(p);
  if (r > R) return 0.0;
  vec3 n = vec3(p, sqrt(R * R - r * r)) / R;
  vec3 q = n;
  q.xz = orbsyRot(uP_spin) * q.xz;
  float lam = clamp(dot(n, normalize(vec3(-0.45, 0.55, 0.7))), 0.0, 1.0);
  float f = fbm3(q * uP_scale + vec3(0.0, uP_speed, uP_speed * 0.6));
  float field = smoothstep(0.25, 0.75, f);
  float tone = mix(lam, field, uP_noiseMix);
  tone *= uP_gain * (1.0 + 0.35 * uInput);
  // shrink the dots toward the limb so the silhouette stays round
  tone *= smoothstep(R, R * 0.9, r);
  return clamp(tone, 0.0, 1.0);
}

void main() {
  vec2 uv = orbUV();
  float px = orbsyPx();
  float R = uP_radius * (1.0 + uP_pulse * uOutput);
  float cell = 2.0 / uP_cells;
  mat2 g = orbsyRot(uP_angle);
  vec2 guv = g * uv;
  vec2 id = floor(guv / cell);

  vec3 col = vec3(0.0);
  float a = 0.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 c = (id + vec2(float(i), float(j)) + 0.5) * cell;
      // back to screen space: v * M is the transpose, i.e. the inverse rotation
      vec2 cw = c * g;
      float tone = halftoneTone(cw, R);
      float rad = sqrt(tone) * cell * uP_dotMax;
      float m = 1.0 - smoothstep(rad - px, rad + px, length(guv - c));
      m *= step(0.001, tone);
      col = mix(col, mix(uC_ink, uC_paper, tone), m);
      a = max(a, m);
    }
  }
  gl_FragColor = vec4(col, a);
}
`;

export const orbsy01Orb: OrbVariant = {
  key: "orbsy-01",
  label: "Halftone",
  note: "a lit, noise-streaked sphere printed through a rotated dot screen",
  frag: HALFTONE_FRAG,
  params: [
    { key: "speed", label: "Field speed", min: 0, max: 4, step: 0.01, default: 0.3, integrate: true },
    { key: "spin", label: "Spin rate", min: 0, max: 3, step: 0.01, default: 0.12, integrate: true },
    { key: "cells", label: "Screen cells", min: 8, max: 80, step: 1, default: 26 },
    { key: "angle", label: "Screen angle", min: 0, max: 1.57, step: 0.01, default: 0.785 },
    { key: "radius", label: "Radius", min: 0.3, max: 1, step: 0.01, default: 0.86 },
    { key: "pulse", label: "Voice pulse", min: 0, max: 0.3, step: 0.005, default: 0.06 },
    { key: "scale", label: "Noise scale", min: 0.5, max: 8, step: 0.05, default: 2.2 },
    { key: "noiseMix", label: "Noise vs light", min: 0, max: 1, step: 0.01, default: 0.4 },
    { key: "gain", label: "Tone gain", min: 0.3, max: 2.5, step: 0.01, default: 1.1 },
    { key: "dotMax", label: "Max dot size", min: 0.2, max: 1, step: 0.01, default: 0.66 }
  ],
  colors: [
    { key: "ink", label: "Shadow ink", default: "#ff5a36" },
    { key: "paper", label: "Highlight ink", default: "#ffe3cc" }
  ],
  statePresets: {
    idle: { speed: 0.3, spin: 0.12, cells: 26, noiseMix: 0.4, gain: 1.1, dotMax: 0.66, scale: 2.2 },
    // finer screen, the noise field takes over the lighting: the orb "mulls"
    thinking: { speed: 0.9, spin: 0.45, cells: 34, noiseMix: 0.75, gain: 1.0, dotMax: 0.6, scale: 3.2 },
    // coarse fat dots that swell with the voice
    speaking: { speed: 1.4, spin: 0.3, cells: 22, noiseMix: 0.55, gain: 1.35, dotMax: 0.74, scale: 2.0 }
  },
  stateColors: {
    idle: { ink: "#ff5a36", paper: "#ffe3cc" },
    thinking: { ink: "#3d5afe", paper: "#c7d2ff" },
    speaking: { ink: "#ff2e63", paper: "#fff3a8" }
  }
};

export type Orbsy01Props = Omit<ShaderOrbProps, "variant">;

export function Orbsy01({ size = 280, ...rest }: Orbsy01Props) {
  return <ShaderOrb variant={orbsy01Orb} size={size} {...rest} />;
}

export default Orbsy01;
