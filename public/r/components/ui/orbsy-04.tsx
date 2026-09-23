/*
 * Orbsy 04 — Contour. Original shader, MIT.
 * Not a "use client" module, so server components can read the variant as data.
 * The shader lives in a template literal: its comments must not contain backticks.
 */
import { ShaderOrb, type OrbVariant, type ShaderOrbProps } from "@/components/ui/orbkit-core";
import { ORBSY_GLSL } from "@/components/ui/orbsy-glsl";

/*
  A topographic map wrapped on a slowly turning globe. The height field is 3D
  fbm on the sphere's normal; isolines are drawn at a constant PIXEL width by
  dividing the distance-to-contour by the field's screen-space gradient,
  measured with two extra samples (WebGL 1 has no fwidth without an
  extension). Every fifth line is an index contour, drawn heavier.
*/
const CONTOUR_FRAG =
  ORBSY_GLSL +
  `
float contourField(vec2 p, float R) {
  float r = length(p);
  float rc = min(r, R * 0.999);
  vec3 n = vec3(p * (rc / max(r, 1e-5)), sqrt(R * R - rc * rc)) / R;
  n.xz = orbsyRot(uP_spin) * n.xz;
  n.yz = orbsyRot(uP_tilt) * n.yz;
  return fbm3(n * uP_scale + vec3(0.0, 0.0, uP_speed));
}

void main() {
  vec2 uv = orbUV();
  float px = orbsyPx();
  float R = uP_radius * (1.0 + 0.04 * uOutput);

  float h = contourField(uv, R);
  float hx = contourField(uv + vec2(px, 0.0), R);
  float hy = contourField(uv + vec2(0.0, px), R);

  float v = h * uP_lines;
  float dv = length(vec2(hx - h, hy - h)) * uP_lines;
  float f = abs(fract(v + 0.5) - 0.5);
  float dpx = f / max(dv, 1e-5);
  float major = 1.0 - step(0.5, mod(floor(v + 0.5), 5.0));
  float wdt = uP_width * mix(1.0, 1.8, major);
  float line = 1.0 - smoothstep(wdt * 0.5 - 0.5, wdt * 0.5 + 0.5, dpx);

  vec4 s = orbsySphere(uv, R, px);
  float lam = clamp(dot(s.xyz, normalize(vec3(-0.4, 0.5, 0.75))), 0.0, 1.0);
  vec3 lc = mix(uC_low, uC_high, smoothstep(0.3, 0.7, h));

  float bright = line * mix(0.6, 1.0, major) * mix(0.35, 1.0, lam);
  vec3 col = lc * bright * uP_glow * (1.0 + 0.6 * uOutput) + uC_low * uP_fill * lam;
  float a = clamp(max(bright, uP_fill * lam * 1.5), 0.0, 1.0) * s.w;
  gl_FragColor = vec4(clamp(col, 0.0, 1.0) * s.w, a);
}
`;

export const orbsy04Orb: OrbVariant = {
  key: "orbsy-04",
  label: "Contour",
  note: "topographic isolines on a slowly turning globe, with heavier index contours",
  frag: CONTOUR_FRAG,
  params: [
    { key: "speed", label: "Terrain drift", min: 0, max: 3, step: 0.01, default: 0.12, integrate: true },
    { key: "spin", label: "Spin rate", min: 0, max: 2, step: 0.01, default: 0.08, integrate: true },
    { key: "tilt", label: "Axial tilt", min: -1.5, max: 1.5, step: 0.01, default: 0.4 },
    { key: "radius", label: "Radius", min: 0.3, max: 1, step: 0.01, default: 0.86 },
    { key: "scale", label: "Terrain scale", min: 0.5, max: 6, step: 0.05, default: 1.6 },
    { key: "lines", label: "Contour count", min: 3, max: 40, step: 0.5, default: 12 },
    { key: "width", label: "Line width (px)", min: 0.5, max: 4, step: 0.05, default: 1.2 },
    { key: "glow", label: "Line brightness", min: 0.2, max: 3, step: 0.01, default: 1.1 },
    { key: "fill", label: "Body fill", min: 0, max: 0.6, step: 0.01, default: 0.08 }
  ],
  colors: [
    { key: "low", label: "Lowland", default: "#1de9b6" },
    { key: "high", label: "Peak", default: "#eaffd0" }
  ],
  statePresets: {
    idle: { speed: 0.12, spin: 0.08, lines: 12, scale: 1.6, width: 1.2, glow: 1.1 },
    // dense survey lines, faster rotation
    thinking: { speed: 0.5, spin: 0.3, lines: 20, scale: 2.4, width: 1.0, glow: 1.1 },
    // terrain boils, lines thicken
    speaking: { speed: 0.9, spin: 0.12, lines: 14, scale: 1.9, width: 1.6, glow: 1.4 }
  },
  stateColors: {
    idle: { low: "#1de9b6", high: "#eaffd0" },
    thinking: { low: "#7c4dff", high: "#e0d4ff" },
    speaking: { low: "#ff9100", high: "#fff1c1" }
  }
};

export type Orbsy04Props = Omit<ShaderOrbProps, "variant">;

export function Orbsy04({ size = 280, ...rest }: Orbsy04Props) {
  return <ShaderOrb variant={orbsy04Orb} size={size} {...rest} />;
}

export default Orbsy04;
