/*
 * Orbsy 06 — Iris. Original shader, MIT.
 * Not a "use client" module, so server components can read the variant as data.
 * The shader lives in a template literal: its comments must not contain backticks.
 */
import { ShaderOrb, type OrbVariant, type ShaderOrbProps } from "../core/orbkit-core";
import { ORBSY_GLSL } from "./orbsy-glsl";

/*
  An eye that watches the conversation. Radial fibres are fbm sampled on the
  unit circle (so there is no seam where the angle wraps) and stretched along
  the radius; a collarette ring, a dark limbal ring and a glowing pupil edge
  finish it. The pupil dilates with the agent's voice.
*/
const IRIS_FRAG =
  ORBSY_GLSL +
  `
void main() {
  vec2 uv = orbUV();
  float px = orbsyPx();
  float R = uP_radius;
  float r = length(uv);
  float mask = 1.0 - smoothstep(R - px, R + px, r);

  float pupil = uP_pupil * (1.0 + uP_dilate * (uOutput - 0.3)) + 0.012 * sin(uP_speed * 3.0);
  pupil = clamp(pupil, 0.05, R * 0.8);
  float rn = clamp((r - pupil) / (R - pupil), 0.0, 1.0);

  float ang = atan(uv.y, uv.x) + uP_spin;
  vec2 dirv = vec2(cos(ang), sin(ang));
  float fib = fbm(dirv * uP_fibers + vec2(rn * uP_depth - uP_speed, uP_speed * 0.3));
  float fib2 = noise(dirv * uP_fibers * 3.0 + vec2(rn * 2.0, uP_speed * 0.5));
  float streak = fib * 0.7 + fib2 * 0.5;

  vec3 col = mix(uC_inner, uC_outer, smoothstep(0.0, 1.0, rn + (streak - 0.6) * 0.5));
  col *= 0.55 + streak * 0.9;

  float cr = (rn - 0.28) / 0.06;
  col += uC_inner * exp(-cr * cr) * 0.6 * (0.5 + streak);
  col *= 1.0 - smoothstep(0.75, 1.0, rn) * uP_limbal;

  float pm = smoothstep(pupil + px, pupil - px, r);
  col = mix(col, uC_pupil, pm);
  col += uC_glow * exp(-abs(r - pupil) / 0.02) * uP_glowAmt * (0.5 + uOutput + 0.5 * uInput);

  vec2 hp = uv - vec2(-0.25, 0.28) * R;
  col += vec3(exp(-dot(hp, hp) / 0.012)) * 0.8 * uP_gloss;

  col = clamp(col, 0.0, 1.0);
  gl_FragColor = vec4(col * mask, mask);
}
`;

export const orbsy06Orb: OrbVariant = {
  key: "orbsy-06",
  label: "Iris",
  note: "a fibrous iris whose pupil dilates and glows with the agent's voice",
  frag: IRIS_FRAG,
  params: [
    { key: "speed", label: "Fibre drift", min: 0, max: 3, step: 0.01, default: 0.25, integrate: true },
    { key: "spin", label: "Iris rotation", min: 0, max: 2, step: 0.01, default: 0.05, integrate: true },
    { key: "radius", label: "Radius", min: 0.3, max: 1, step: 0.01, default: 0.86 },
    { key: "pupil", label: "Pupil size", min: 0.05, max: 0.6, step: 0.005, default: 0.3 },
    { key: "dilate", label: "Voice dilation", min: 0, max: 1, step: 0.01, default: 0.3 },
    { key: "fibers", label: "Fibre density", min: 0.5, max: 10, step: 0.05, default: 3.5 },
    { key: "depth", label: "Fibre length", min: 0.5, max: 8, step: 0.05, default: 3.0 },
    { key: "limbal", label: "Limbal ring", min: 0, max: 1, step: 0.01, default: 0.75 },
    { key: "glowAmt", label: "Pupil glow", min: 0, max: 2, step: 0.01, default: 0.6 },
    { key: "gloss", label: "Catchlight", min: 0, max: 1.5, step: 0.01, default: 0.6 }
  ],
  colors: [
    { key: "inner", label: "Inner iris", default: "#ffb347" },
    { key: "outer", label: "Outer iris", default: "#2f9e8f" },
    { key: "pupil", label: "Pupil", default: "#05060a" },
    { key: "glow", label: "Pupil glow", default: "#ffd27a" }
  ],
  statePresets: {
    idle: { speed: 0.25, spin: 0.05, pupil: 0.3, dilate: 0.3, fibers: 3.5, glowAmt: 0.6 },
    // pupil narrows to focus, the iris turns
    thinking: { speed: 0.8, spin: 0.4, pupil: 0.2, dilate: 0.2, fibers: 4.5, glowAmt: 0.9 },
    // pupil opens wide and flares
    speaking: { speed: 1.2, spin: 0.1, pupil: 0.36, dilate: 0.6, fibers: 3.5, glowAmt: 1.2 }
  },
  stateColors: {
    idle: { inner: "#ffb347", outer: "#2f9e8f", pupil: "#05060a", glow: "#ffd27a" },
    thinking: { inner: "#a6e3ff", outer: "#3949ab", pupil: "#03040c", glow: "#8fd8ff" },
    speaking: { inner: "#ffd54f", outer: "#d84315", pupil: "#0a0403", glow: "#ffec99" }
  }
};

export type Orbsy06Props = Omit<ShaderOrbProps, "variant">;

export function Orbsy06({ size = 280, ...rest }: Orbsy06Props) {
  return <ShaderOrb variant={orbsy06Orb} size={size} {...rest} />;
}

export default Orbsy06;
