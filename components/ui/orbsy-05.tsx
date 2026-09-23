/*
 * Orbsy 05 — Pixel. Original shader, MIT.
 * Not a "use client" module, so server components can read the variant as data.
 * The shader lives in a template literal: its comments must not contain backticks.
 */
import { ShaderOrb, type OrbVariant, type ShaderOrbProps } from "@/components/ui/orbkit-core";
import { ORBSY_GLSL } from "@/components/ui/orbsy-glsl";

/*
  A low-res sprite of a sphere: the screen is cut into square blocks, each
  block samples the lit, noise-streaked ball once and snaps it to a small
  four-colour ramp. Rows occasionally slip sideways (a stepped glitch clock
  picks which) and single blocks flash hot, both more often when the orb is
  busy or hearing input.
*/
const PIXEL_FRAG =
  ORBSY_GLSL +
  `
void main() {
  vec2 uv = orbUV();
  float px = orbsyPx();
  float R = uP_radius * (1.0 + uP_pulse * uOutput);
  float cell = 2.0 / uP_blocks;

  float gT = floor(uP_glitchClock);
  float row = floor(uv.y / cell);
  float roll = hash(vec2(row, gT));
  float slip = step(1.0 - uP_glitch * (0.3 + uInput), roll);
  float shift = slip * (hash(vec2(row * 1.7, gT + 3.0)) - 0.5) * cell * 6.0;
  vec2 p = uv + vec2(shift, 0.0);

  vec2 id = floor(p / cell);
  vec2 c = (id + 0.5) * cell;
  vec2 f = (p - c) / cell;
  float r = length(c);
  float inside = step(r, R);

  float rc = min(r, R * 0.999);
  vec3 n = vec3(c * (rc / max(r, 1e-5)), sqrt(R * R - rc * rc)) / R;
  vec3 q = n;
  q.xz = orbsyRot(uP_spin) * q.xz;
  float lam = clamp(dot(n, normalize(vec3(-0.5, 0.55, 0.68))), 0.0, 1.0);
  float field = fbm3(q * uP_scale + vec3(0.0, uP_speed, 0.0));
  float tone = clamp(mix(lam, field * 1.4, uP_noiseMix) * uP_gain, 0.0, 1.0);
  float L = max(uP_levels, 2.0);
  float lv = min(floor(tone * L), L - 1.0) / (L - 1.0);

  vec3 col = mix(uC_dark, uC_mid, smoothstep(0.0, 0.34, lv));
  col = mix(col, uC_light, smoothstep(0.33, 0.67, lv));
  col = mix(col, uC_hot, smoothstep(0.66, 1.0, lv));

  float fl = hash(id + vec2(floor(uP_glitchClock * 3.0) * 7.31, 1.9));
  col = mix(col, uC_hot, step(1.0 - uP_sparkle * (0.2 + uOutput), fl) * 0.7);

  // square block with a hairline gap, antialiased in block units
  float e = px / cell;
  float g = 0.5 - uP_gap;
  float blockMask = (1.0 - smoothstep(g - e, g + e, abs(f.x))) * (1.0 - smoothstep(g - e, g + e, abs(f.y)));
  float a = blockMask * inside;
  gl_FragColor = vec4(col * a, a);
}
`;

export const orbsy05Orb: OrbVariant = {
  key: "orbsy-05",
  label: "Pixel",
  note: "a four-colour low-res sprite of a sphere with slipping glitch rows",
  frag: PIXEL_FRAG,
  params: [
    { key: "speed", label: "Field speed", min: 0, max: 4, step: 0.01, default: 0.3, integrate: true },
    { key: "spin", label: "Spin rate", min: 0, max: 3, step: 0.01, default: 0.2, integrate: true },
    { key: "glitchClock", label: "Glitch rate", min: 0, max: 12, step: 0.1, default: 1.0, integrate: true },
    { key: "radius", label: "Radius", min: 0.3, max: 1, step: 0.01, default: 0.86 },
    { key: "pulse", label: "Voice pulse", min: 0, max: 0.3, step: 0.005, default: 0.05 },
    { key: "blocks", label: "Blocks across", min: 8, max: 64, step: 1, default: 24 },
    { key: "scale", label: "Noise scale", min: 0.5, max: 8, step: 0.05, default: 2.4 },
    { key: "noiseMix", label: "Noise vs light", min: 0, max: 1, step: 0.01, default: 0.5 },
    { key: "gain", label: "Tone gain", min: 0.3, max: 2.5, step: 0.01, default: 1.1 },
    { key: "levels", label: "Colour levels", min: 2, max: 8, step: 1, default: 5 },
    { key: "glitch", label: "Row glitch", min: 0, max: 1, step: 0.01, default: 0.05 },
    { key: "sparkle", label: "Block sparkle", min: 0, max: 0.5, step: 0.005, default: 0.02 },
    { key: "gap", label: "Block gap", min: 0, max: 0.3, step: 0.005, default: 0.08 }
  ],
  colors: [
    { key: "dark", label: "Dark", default: "#1b1033" },
    { key: "mid", label: "Mid", default: "#5b2a86" },
    { key: "light", label: "Light", default: "#ff5fa2" },
    { key: "hot", label: "Hot", default: "#fff38a" }
  ],
  statePresets: {
    idle: { speed: 0.3, spin: 0.2, glitchClock: 1.0, blocks: 24, glitch: 0.05, sparkle: 0.02, gain: 1.1 },
    // finer grid, lots of slipping rows: processing
    thinking: { speed: 0.8, spin: 0.4, glitchClock: 5.0, blocks: 32, glitch: 0.35, sparkle: 0.15, gain: 1.0 },
    // chunky, bright, flashing
    speaking: { speed: 1.3, spin: 0.25, glitchClock: 3.0, blocks: 20, glitch: 0.2, sparkle: 0.1, gain: 1.3 }
  },
  stateColors: {
    idle: { dark: "#1b1033", mid: "#5b2a86", light: "#ff5fa2", hot: "#fff38a" },
    thinking: { dark: "#031b1f", mid: "#0b5c63", light: "#28e0c8", hot: "#e8fffb" },
    speaking: { dark: "#2a0a00", mid: "#8a2400", light: "#ff6b1a", hot: "#fff0b3" }
  }
};

export type Orbsy05Props = Omit<ShaderOrbProps, "variant">;

export function Orbsy05({ size = 280, ...rest }: Orbsy05Props) {
  return <ShaderOrb variant={orbsy05Orb} size={size} {...rest} />;
}

export default Orbsy05;
