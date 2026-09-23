/*
 * Orbsy 10 — Bubble. Original shader, MIT.
 * Not a "use client" module, so server components can read the variant as data.
 * The shader lives in a template literal: its comments must not contain backticks.
 */
import { ShaderOrb, type OrbVariant, type ShaderOrbProps } from "../core/orbkit-core";
import { ORBSY_GLSL } from "./orbsy-glsl";

/*
  A soap bubble. Film thickness is a swirling fbm field plus a drainage term
  (film pools toward the bottom), and colour comes from thin-film
  interference: the optical path 2 n d cos(theta_t) sets a per-channel phase.
  Schlick fresnel makes the centre nearly clear and the rim bright, which is
  what makes it read as a bubble on any background.
*/
const BUBBLE_FRAG =
  ORBSY_GLSL +
  `
void main() {
  vec2 uv = orbUV();
  float px = orbsyPx();
  float R = uP_radius * (1.0 + uP_pulse * uOutput);
  vec4 s = orbsySphere(uv, R, px);
  vec3 n = s.xyz;
  float cosT = s.z;

  vec3 q = n;
  q.xz = orbsyRot(uP_spin) * q.xz;
  float inner = fbm3(q * 1.3 - vec3(uP_speed * 0.3));
  float sw = fbm3(q * uP_swirlScale + vec3(0.0, uP_speed, uP_speed * 0.5) + vec3(0.8 * inner));
  float thick = uP_thick + uP_swirl * (sw - 0.5) * (1.0 + 0.6 * uInput) - n.y * uP_drain;

  float sinT2 = 1.0 - cosT * cosT;
  float cosR = sqrt(max(1.0 - sinT2 / (1.33 * 1.33), 0.0));
  float opd = 2.0 * 1.33 * thick * cosR;
  vec3 film = 0.5 + 0.5 * cos(TAU * opd * uP_bands * vec3(1.0, 1.18, 1.39) + uP_hue);
  // real films are pastel, not fully saturated
  film = mix(vec3(dot(film, vec3(0.3333))), film, 0.75);

  float g = 1.0 - cosT;
  float fres = 0.04 + 0.96 * g * g * g * g * g;
  vec3 col = film * mix(uP_body, 1.0, fres) * uP_bright * uC_tint;

  vec2 h1 = (uv / R - vec2(-0.35, 0.4)) * vec2(1.0, 1.8);
  vec2 h2 = uv / R - vec2(0.4, -0.45);
  col += vec3(exp(-dot(h1, h1) / 0.02)) * uP_gloss;
  col += vec3(exp(-dot(h2, h2) / 0.01)) * uP_gloss * 0.35;

  col = clamp(col, 0.0, 1.0) * s.w;
  float a = clamp(max(col.r, max(col.g, col.b)) * 1.2, 0.0, 1.0);
  gl_FragColor = vec4(col, a);
}
`;

export const orbsy10Orb: OrbVariant = {
  key: "orbsy-10",
  label: "Bubble",
  note: "a soap bubble with swirling thin-film interference and a bright fresnel rim",
  frag: BUBBLE_FRAG,
  params: [
    { key: "speed", label: "Film flow", min: 0, max: 3, step: 0.01, default: 0.3, integrate: true },
    { key: "spin", label: "Spin rate", min: 0, max: 2, step: 0.01, default: 0.1, integrate: true },
    { key: "radius", label: "Radius", min: 0.3, max: 1, step: 0.01, default: 0.86 },
    { key: "pulse", label: "Voice pulse", min: 0, max: 0.3, step: 0.005, default: 0.05 },
    { key: "swirlScale", label: "Swirl scale", min: 0.5, max: 6, step: 0.05, default: 1.5 },
    { key: "swirl", label: "Swirl strength", min: 0, max: 2, step: 0.01, default: 0.35 },
    { key: "thick", label: "Film thickness", min: 0, max: 2, step: 0.01, default: 0.45 },
    { key: "drain", label: "Drainage", min: 0, max: 1, step: 0.01, default: 0.15 },
    { key: "bands", label: "Interference bands", min: 0.5, max: 8, step: 0.05, default: 1.6 },
    { key: "hue", label: "Hue shift", min: 0, max: 6.28, step: 0.01, default: 0 },
    { key: "body", label: "Face opacity", min: 0, max: 1, step: 0.01, default: 0.06 },
    { key: "bright", label: "Brightness", min: 0.2, max: 3, step: 0.01, default: 1.2 },
    { key: "gloss", label: "Window reflections", min: 0, max: 1.5, step: 0.01, default: 0.8 }
  ],
  colors: [{ key: "tint", label: "Tint", default: "#ffffff" }],
  statePresets: {
    idle: { speed: 0.3, spin: 0.1, swirl: 0.35, bands: 1.6, body: 0.06, bright: 1.2, hue: 0 },
    // tighter bands racing round the film
    thinking: { speed: 0.9, spin: 0.4, swirl: 0.6, bands: 2.4, body: 0.08, bright: 1.2, hue: 0.6 },
    // fuller, warmer, more opaque face
    speaking: { speed: 1.4, spin: 0.15, swirl: 0.5, bands: 1.4, body: 0.12, bright: 1.4, hue: 1.2 }
  },
  stateColors: {
    idle: { tint: "#ffffff" },
    thinking: { tint: "#cfe3ff" },
    speaking: { tint: "#ffe6d1" }
  }
};

export type Orbsy10Props = Omit<ShaderOrbProps, "variant">;

export function Orbsy10({ size = 280, ...rest }: Orbsy10Props) {
  return <ShaderOrb variant={orbsy10Orb} size={size} {...rest} />;
}

export default Orbsy10;
