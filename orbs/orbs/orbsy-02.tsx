/*
 * Orbsy 02 — Chrome. Original shader, MIT.
 * Not a "use client" module, so server components can read the variant as data.
 * The shader lives in a template literal: its comments must not contain backticks.
 */
import { ShaderOrb, type OrbVariant, type ShaderOrbProps } from "../core/orbkit-core";
import { ORBSY_GLSL } from "./orbsy-glsl";

/*
  A liquid-metal blob: a sphere SDF displaced by interfering sines, sphere
  traced, then shaded purely by reflecting a procedural studio (sky, horizon
  line, two softboxes, a sun). A fresnel-driven thin-film term adds the oily
  iridescence at grazing angles. The silhouette is antialiased from the ray's
  closest approach, so misses near the limb still fade smoothly.
*/
const CHROME_FRAG =
  ORBSY_GLSL +
  `
#define STEPS 64

float chromeAmp;

float chromeMap(vec3 p) {
  vec3 q = p;
  q.xz = orbsyRot(uP_spin) * q.xz;
  float t = uP_speed;
  float f = uP_freq;
  float d = sin(q.x * f + t) * sin(q.y * f * 1.1 + t * 1.3) * sin(q.z * f * 0.9 + t * 0.7);
  d += 0.5 * sin(q.x * f * 2.1 - t * 1.7 + q.z * 1.3) * sin(q.y * f * 1.9 + t);
  return length(p) - uP_radius + d * chromeAmp;
}

vec3 chromeNormal(vec3 p) {
  vec2 e = vec2(0.002, -0.002);
  return normalize(
    e.xyy * chromeMap(p + e.xyy) +
    e.yyx * chromeMap(p + e.yyx) +
    e.yxy * chromeMap(p + e.yxy) +
    e.xxx * chromeMap(p + e.xxx)
  );
}

vec3 chromeEnv(vec3 d) {
  d.xz = orbsyRot(uP_envSpin) * d.xz;
  float y = d.y;
  vec3 c = mix(uC_ground, uC_sky, smoothstep(-0.35, 0.35, y));
  c = mix(c, uC_ground * 0.6 + uC_sky * 0.12, smoothstep(0.0, -0.6, y));
  // floor bounce, so the underside never goes flat black
  c += uC_sky * 0.35 * smoothstep(-0.5, -1.0, y);
  c += vec3(0.9) * smoothstep(0.035, 0.0, abs(y - 0.02));
  float box1 = smoothstep(0.22, 0.16, abs(d.x - 0.35)) * smoothstep(0.25, 0.4, y) * smoothstep(0.95, 0.8, y);
  float box2 = smoothstep(0.1, 0.05, abs(d.z + 0.5)) * smoothstep(0.1, 0.3, y);
  c += vec3(1.6) * box1 + vec3(0.8) * box2;
  c += vec3(2.0) * pow(max(dot(d, normalize(vec3(-0.6, 0.5, 0.6))), 0.0), 48.0);
  return c;
}

void main() {
  vec2 uv = orbUV();
  float px = orbsyPx();
  chromeAmp = uP_wobble * (1.0 + uP_react * uOutput) * (1.0 + 0.4 * uInput);

  vec3 ro = vec3(0.0, 0.0, uP_camDist);
  vec3 rd = normalize(vec3(uv, -uP_focal));
  float t = uP_camDist - uP_radius * 1.6;
  float tEnd = uP_camDist + uP_radius * 1.6;
  float md = 1e3;
  float tm = t;
  for (int i = 0; i < STEPS; i++) {
    float d = chromeMap(ro + rd * t);
    if (d < md) { md = d; tm = t; }
    if (d < 0.001 || t > tEnd) break;
    // displacement breaks the SDF's Lipschitz bound, so under-step
    t += d * 0.7;
  }

  vec3 p = ro + rd * tm;
  vec3 n = chromeNormal(p);
  vec3 r = reflect(rd, n);
  float fres = pow(1.0 - max(dot(n, -rd), 0.0), 3.0);
  vec3 col = chromeEnv(r) * mix(0.55, 1.0, fres);

  vec3 irid = 0.5 + 0.5 * cos(TAU * (fres * uP_iridBands + vec3(0.0, 0.33, 0.67)) + uP_speed * 0.2);
  col = mix(col, col * irid * 1.6 + uC_accent * fres, uP_irid);
  col = tanh3(col * uP_exposure);

  float fw = px * uP_camDist / uP_focal * 1.5;
  float a = 1.0 - smoothstep(0.0, fw, md);
  gl_FragColor = vec4(col * a, a);
}
`;

export const orbsy02Orb: OrbVariant = {
  key: "orbsy-02",
  label: "Chrome",
  note: "a liquid-metal blob reflecting a procedural studio, with oily iridescence",
  frag: CHROME_FRAG,
  params: [
    { key: "speed", label: "Flow speed", min: 0, max: 4, step: 0.01, default: 0.5, integrate: true },
    { key: "spin", label: "Spin rate", min: 0, max: 3, step: 0.01, default: 0.15, integrate: true },
    { key: "envSpin", label: "Studio spin", min: 0, max: 2, step: 0.01, default: 0.1, integrate: true },
    { key: "radius", label: "Radius", min: 0.5, max: 1.4, step: 0.01, default: 1.0 },
    { key: "freq", label: "Ripple frequency", min: 0.5, max: 6, step: 0.05, default: 2.2 },
    { key: "wobble", label: "Ripple depth", min: 0, max: 0.3, step: 0.005, default: 0.03 },
    { key: "react", label: "Voice reactivity", min: 0, max: 3, step: 0.05, default: 0.6 },
    { key: "camDist", label: "Camera distance", min: 2, max: 8, step: 0.05, default: 3.2 },
    { key: "focal", label: "Lens", min: 1, max: 6, step: 0.05, default: 2.6 },
    { key: "irid", label: "Iridescence", min: 0, max: 1, step: 0.01, default: 0.35 },
    { key: "iridBands", label: "Film bands", min: 0, max: 5, step: 0.05, default: 1.5 },
    { key: "exposure", label: "Exposure", min: 0.3, max: 3, step: 0.01, default: 1.1 }
  ],
  colors: [
    { key: "sky", label: "Sky", default: "#e6ecff" },
    { key: "ground", label: "Ground", default: "#1a1c24" },
    { key: "accent", label: "Film accent", default: "#7c5cff" }
  ],
  statePresets: {
    idle: { speed: 0.5, spin: 0.15, envSpin: 0.1, freq: 2.2, wobble: 0.03, react: 0.6, irid: 0.35 },
    // tighter, faster ripples and the studio swinging round
    thinking: { speed: 1.1, spin: 0.35, envSpin: 0.35, freq: 3.2, wobble: 0.045, react: 0.6, irid: 0.6 },
    // bigger gloops that bulge with the voice
    speaking: { speed: 1.6, spin: 0.25, envSpin: 0.15, freq: 2.0, wobble: 0.055, react: 1.0, irid: 0.45 }
  },
  stateColors: {
    idle: { sky: "#e6ecff", ground: "#1a1c24", accent: "#7c5cff" },
    thinking: { sky: "#d6fff6", ground: "#0f1d22", accent: "#00d1b2" },
    speaking: { sky: "#fff0e0", ground: "#22160f", accent: "#ff6a3d" }
  }
};

export type Orbsy02Props = Omit<ShaderOrbProps, "variant">;

export function Orbsy02({ size = 280, ...rest }: Orbsy02Props) {
  return <ShaderOrb variant={orbsy02Orb} size={size} {...rest} />;
}

export default Orbsy02;
