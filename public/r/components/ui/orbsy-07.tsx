/*
 * Orbsy 07 — Waveform. Original shader, MIT.
 * Not a "use client" module, so server components can read the variant as data.
 * The shader lives in a template literal: its comments must not contain backticks.
 */
import { ShaderOrb, type OrbVariant, type ShaderOrbProps } from "@/components/ui/orbkit-core";
import { ORBSY_GLSL } from "@/components/ui/orbsy-glsl";

/*
  Signal traces wrapped on a sphere: each trace is a latitude ring of a
  globe tilted toward the viewer and turning about its axis, so the rings
  read as ellipses, the far halves show faintly through the glass, and the
  noise that displaces each ring travels around the ball with the spin. The
  displacement is driven by the agent's output volume, so the ball visibly
  "talks".

  Each ring is solved analytically per pixel: the pixel's x fixes cos(theta)
  on the ring, which leaves exactly two points (front and back), and the
  distance to each is the vertical miss divided by the curve's slope term, so
  lines keep a constant pixel width even where the ellipse turns steep.

  The silhouette is organic rather than cut: a faint glass body with a
  wandering, feathered rim, and a glow in the trace colours that bleeds past
  it in tendrils.
*/
const WAVEFORM_FRAG =
  ORBSY_GLSL +
  `
#define LINES 30

// Displacement for ring fi at longitude th: seamless around the ring
// because the angle enters only through its cosine and sine.
float waveNoise(float th, float fi) {
  vec2 c = vec2(cos(th), sin(th)) * uP_freq;
  float n = noise(c + vec2(fi * 3.1, uP_speed + fi * 0.37)) - 0.5;
  n += 0.5 * (noise(c * 2.3 + vec2(-fi * 1.3, uP_speed * 1.7 + fi)) - 0.5);
  return n;
}

void main() {
  vec2 uv = orbUV();
  float px = orbsyPx();
  float R = uP_radius;
  float r = length(uv);
  float ct = cos(uP_tilt);
  float st = sin(uP_tilt);
  float amp = uP_amp * (0.35 + uP_react * uOutput) * (1.0 + 0.4 * uInput);
  float hw = uP_width * px * 0.5;

  vec3 acc = vec3(0.0);
  for (int i = 0; i < LINES; i++) {
    float fi = float(i);
    float k = (fi + 0.5) / float(LINES);
    float phi = (k - 0.5) * PI * 0.92;
    float cp = cos(phi);
    float sp = sin(phi);
    float u = uv.x / (R * cp);
    if (abs(u) > 1.0) continue;
    float sq = sqrt(1.0 - u * u);
    vec3 lc = mix(uC_bottom, uC_top, k);

    for (int side = 0; side < 2; side++) {
      // sinT > 0 is the half of the ring nearer the viewer.
      float sinT = side == 0 ? sq : -sq;
      float th = atan(sinT, u) + uP_spin;
      float depth = sp * st + cp * sinT * ct;
      float y = R * (sp * ct - cp * sinT * st);
      // wave height scales with the ring's size and tapers where the
      // ellipse turns back on itself
      y += waveNoise(th, fi) * amp * R * cp * sq;

      // The slope estimate only holds while the ring is not turning back on
      // itself; near its ends it would smear into vertical streaks, so it
      // fades out there and the exact distance to the end point takes over.
      float slope = st * (side == 0 ? 1.0 : -1.0) * u / max(sq, 0.08);
      float dCurve = abs(uv.y - y) / sqrt(1.0 + slope * slope);
      dCurve += (1.0 - smoothstep(0.04, 0.2, sq)) * 1e3;
      float dEnd = length(uv - vec2(sign(u) * R * cp, R * sp * ct));
      float d = min(dCurve, dEnd);
      float core = 1.0 - smoothstep(hw, hw + px, d);
      float glow = exp(-d / (uP_glow * 0.02 + 1e-4)) * 0.35;
      float front = mix(uP_back, 1.0, smoothstep(-0.08, 0.08, depth));
      acc += lc * (core + glow) * front;
    }
  }

  // Glass body with an organic rim, brighter toward the limb like a bubble.
  float mask = orbOrganicMask(uv, R, uP_organic, uP_edgeSoft, uP_edgeFlow);
  float z = sqrt(max(1.0 - r * r / (R * R), 0.0));
  float limb = 1.0 - z;
  vec3 tint = mix(uC_bottom, uC_top, clamp(0.5 + 0.5 * uv.y / R, 0.0, 1.0));
  vec3 body = tint * uP_fill * (0.25 + limb * limb * limb) * mask;

  // Energy creeping out past the rim in the trace colours.
  float bleed = orbBleed(uv, R, uP_reach, uP_edgeFlow) * uP_bleed * (0.6 + 0.8 * uOutput);
  vec3 halo = tint * bleed * 0.45 * (1.0 - mask);

  vec3 col = tanh3(acc * uP_exposure + body + halo);
  float a = clamp(max(col.r, max(col.g, col.b)) * 1.2, 0.0, 1.0);
  gl_FragColor = vec4(col, a);
}
`;

export const orbsy07Orb: OrbVariant = {
  key: "orbsy-07",
  label: "Waveform",
  note: "signal traces wrapped on a turning globe that bulge when the agent speaks",
  frag: WAVEFORM_FRAG,
  params: [
    { key: "speed", label: "Signal speed", min: 0, max: 5, step: 0.01, default: 0.4, integrate: true },
    { key: "spin", label: "Spin rate", min: 0, max: 3, step: 0.01, default: 0.25, integrate: true },
    { key: "radius", label: "Radius", min: 0.3, max: 1, step: 0.01, default: 0.78 },
    { key: "tilt", label: "Tilt toward viewer", min: -1.2, max: 1.2, step: 0.01, default: 0.35 },
    { key: "amp", label: "Amplitude", min: 0, max: 1.2, step: 0.01, default: 0.2 },
    { key: "react", label: "Voice reactivity", min: 0, max: 2, step: 0.01, default: 1.0 },
    { key: "freq", label: "Signal frequency", min: 0.5, max: 10, step: 0.05, default: 2.4 },
    { key: "width", label: "Line width (px)", min: 0.5, max: 4, step: 0.05, default: 1.4 },
    { key: "glow", label: "Glow", min: 0, max: 2, step: 0.01, default: 0.6 },
    { key: "back", label: "Far side", min: 0, max: 1, step: 0.01, default: 0.22 },
    { key: "fill", label: "Glass body", min: 0, max: 1, step: 0.01, default: 0.35 },
    { key: "exposure", label: "Exposure", min: 0.3, max: 4, step: 0.01, default: 1.4 },
    { key: "organic", label: "Rim wander", min: 0, max: 0.15, step: 0.005, default: 0.04 },
    { key: "edgeSoft", label: "Rim feather", min: 0, max: 0.2, step: 0.005, default: 0.05 },
    { key: "bleed", label: "Energy bleed", min: 0, max: 3, step: 0.01, default: 0.9 },
    { key: "reach", label: "Bleed reach", min: 0.02, max: 0.5, step: 0.005, default: 0.1 },
    { key: "edgeFlow", label: "Edge flow", min: 0, max: 3, step: 0.01, default: 0.35, integrate: true }
  ],
  colors: [
    { key: "top", label: "Top trace", default: "#7df9ff" },
    { key: "bottom", label: "Bottom trace", default: "#ff4ecd" }
  ],
  statePresets: {
    idle: {
      speed: 0.4, spin: 0.25, amp: 0.2, react: 1.0, freq: 2.4, glow: 0.6, exposure: 1.4,
      organic: 0.03, bleed: 0.7, reach: 0.09, edgeFlow: 0.3
    },
    // fast, fine-grained chatter with low amplitude, the globe turning quickly
    thinking: {
      speed: 1.4, spin: 0.8, amp: 0.3, react: 1.0, freq: 5.0, glow: 0.4, exposure: 1.4,
      organic: 0.045, bleed: 0.9, reach: 0.1, edgeFlow: 0.8
    },
    // big peaks that follow the voice, energy spilling off the rim
    speaking: {
      speed: 1.8, spin: 0.35, amp: 0.6, react: 1.3, freq: 3.0, glow: 0.8, exposure: 1.6,
      organic: 0.06, bleed: 1.3, reach: 0.13, edgeFlow: 1.1
    }
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
