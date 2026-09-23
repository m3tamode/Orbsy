/*
 * Orbsy 07 — Waveform. Original shader, MIT.
 * Not a "use client" module, so server components can read the variant as data.
 * The shader lives in a template literal: its comments must not contain backticks.
 */
import { ShaderOrb, type OrbVariant, type ShaderOrbProps } from "../core/orbkit-core";
import { ORBSY_GLSL } from "./orbsy-glsl";

/*
  Stacked signal traces clipped to a disc, in the spirit of a pulsar plot:
  each line is a chord of the circle, displaced by two octaves of noise under
  an envelope that is zero at the chord's ends and peaks in the middle. The
  displacement is driven by the agent's output volume, so the ball visibly
  "talks". Lines are a hairline core plus an exponential glow.
*/
const WAVEFORM_FRAG =
  ORBSY_GLSL +
  `
#define LINES 32

void main() {
  vec2 uv = orbsyRot(uP_tilt) * orbUV();
  float px = orbsyPx();
  float R = uP_radius;
  float amp = uP_amp * (0.35 + uP_react * uOutput) * (1.0 + 0.4 * uInput);

  vec3 acc = vec3(0.0);
  for (int i = 0; i < LINES; i++) {
    float fi = float(i);
    float k = (fi + 0.5) / float(LINES);
    float y0 = mix(-R, R, k) * 0.94;
    float halfW = sqrt(max(R * R - y0 * y0, 0.0));
    float x = uv.x;
    float env = smoothstep(halfW, 0.0, abs(x));
    env *= env;
    float n = noise(vec2(x * uP_freq + fi * 3.1, uP_speed + fi * 0.37)) - 0.5;
    n += 0.5 * (noise(vec2(x * uP_freq * 2.3 - fi * 1.3, uP_speed * 1.7 + fi)) - 0.5);
    float y = y0 + n * amp * env;
    float d = abs(uv.y - y);
    float inX = smoothstep(halfW + px, halfW - px, abs(x));
    float hw = uP_width * px * 0.5;
    float core = 1.0 - smoothstep(hw, hw + px, d);
    float glow = exp(-d / (uP_glow * 0.02 + 1e-4)) * 0.35;
    acc += mix(uC_bottom, uC_top, k) * (core + glow) * inX;
  }

  vec3 col = tanh3(acc * uP_exposure);
  float a = clamp(max(col.r, max(col.g, col.b)) * 1.2, 0.0, 1.0);
  gl_FragColor = vec4(col, a);
}
`;

export const orbsy07Orb: OrbVariant = {
  key: "orbsy-07",
  label: "Waveform",
  note: "stacked pulsar-plot signal traces that bulge when the agent speaks",
  frag: WAVEFORM_FRAG,
  params: [
    { key: "speed", label: "Signal speed", min: 0, max: 5, step: 0.01, default: 0.4, integrate: true },
    { key: "radius", label: "Radius", min: 0.3, max: 1, step: 0.01, default: 0.86 },
    { key: "tilt", label: "Tilt", min: -1.57, max: 1.57, step: 0.01, default: 0 },
    { key: "amp", label: "Amplitude", min: 0, max: 1.2, step: 0.01, default: 0.2 },
    { key: "react", label: "Voice reactivity", min: 0, max: 2, step: 0.01, default: 1.0 },
    { key: "freq", label: "Signal frequency", min: 0.5, max: 10, step: 0.05, default: 2.4 },
    { key: "width", label: "Line width (px)", min: 0.5, max: 4, step: 0.05, default: 1.4 },
    { key: "glow", label: "Glow", min: 0, max: 2, step: 0.01, default: 0.6 },
    { key: "exposure", label: "Exposure", min: 0.3, max: 4, step: 0.01, default: 1.4 }
  ],
  colors: [
    { key: "top", label: "Top trace", default: "#7df9ff" },
    { key: "bottom", label: "Bottom trace", default: "#ff4ecd" }
  ],
  statePresets: {
    idle: { speed: 0.4, amp: 0.2, react: 1.0, freq: 2.4, glow: 0.6, exposure: 1.4 },
    // fast, fine-grained chatter with low amplitude
    thinking: { speed: 1.4, amp: 0.3, react: 1.0, freq: 5.0, glow: 0.4, exposure: 1.4 },
    // big peaks that follow the voice
    speaking: { speed: 1.8, amp: 0.6, react: 1.3, freq: 3.0, glow: 0.8, exposure: 1.6 }
  },
  stateColors: {
    idle: { top: "#7df9ff", bottom: "#ff4ecd" },
    thinking: { top: "#b39dff", bottom: "#3d5afe" },
    speaking: { top: "#fff176", bottom: "#ff3d00" }
  }
};

export type Orbsy07Props = Omit<ShaderOrbProps, "variant">;

export function Orbsy07({ size = 280, ...rest }: Orbsy07Props) {
  return <ShaderOrb variant={orbsy07Orb} size={size} {...rest} />;
}

export default Orbsy07;
