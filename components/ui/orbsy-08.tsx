/*
 * Orbsy 08 — Nebula. Original shader, MIT.
 * Not a "use client" module, so server components can read the variant as data.
 * The shader lives in a template literal: its comments must not contain backticks.
 */
import { ShaderOrb, type OrbVariant, type ShaderOrbProps } from "@/components/ui/orbkit-core";
import { ORBSY_GLSL } from "@/components/ui/orbsy-glsl";

/*
  A pocket galaxy: two-level domain-warped 3D fbm on the sphere's normal gives
  swirling gas in three colours, a hashed 3D cell grid scatters twinkling
  stars through it, and limb darkening plus a rim and an outer halo sell the
  ball as a glowing volume rather than a painted disc.
*/
const NEBULA_FRAG =
  ORBSY_GLSL +
  `
void main() {
  vec2 uv = orbUV();
  float px = orbsyPx();
  float R = uP_radius * (1.0 + 0.04 * uOutput);
  vec4 s = orbsySphere(uv, R, px);

  vec3 n = s.xyz;
  n.xz = orbsyRot(uP_spin) * n.xz;
  vec3 p = n * uP_scale;
  float t = uP_speed;
  vec3 q = vec3(fbm3(p + vec3(0.0, 0.0, t)), fbm3(p + vec3(5.2, 1.3, -t)), 0.0);
  float f = fbm3(p + q * uP_warp * (1.0 + 0.5 * uInput) + vec3(t * 0.5));

  vec3 col = mix(uC_deep, uC_gas, smoothstep(0.2, 0.8, f));
  col = mix(col, uC_hot, smoothstep(0.35, 0.8, f * q.x * 1.6));
  col *= uP_bright * (0.8 + 0.4 * uOutput);

  vec3 sp = n * uP_stars;
  vec3 sf = fract(sp) - 0.5;
  float sh = hash31(floor(sp));
  float star = step(0.93, sh) * exp(-dot(sf, sf) * 60.0) * (0.6 + 0.4 * sin(t * 6.0 + sh * 40.0));
  col += vec3(star) * uP_starAmt;

  col *= mix(0.35, 1.0, s.z);
  float limb = 1.0 - s.z;
  col += uC_gas * limb * limb * limb * limb * uP_rim;

  float r = length(uv);
  float halo = exp(-max(r - R, 0.0) / (0.06 * uP_halo + 1e-3)) * (1.0 - s.w) * uP_halo;
  col = col * s.w + uC_gas * halo * 0.6;
  col = tanh3(col);
  float a = clamp(max(s.w, halo * 0.6), 0.0, 1.0);
  gl_FragColor = vec4(col, a);
}
`;

export const orbsy08Orb: OrbVariant = {
  key: "orbsy-08",
  label: "Nebula",
  note: "domain-warped gas and twinkling stars inside a glowing pocket galaxy",
  frag: NEBULA_FRAG,
  params: [
    { key: "speed", label: "Gas flow", min: 0, max: 3, step: 0.01, default: 0.2, integrate: true },
    { key: "spin", label: "Spin rate", min: 0, max: 2, step: 0.01, default: 0.06, integrate: true },
    { key: "radius", label: "Radius", min: 0.3, max: 1, step: 0.01, default: 0.8 },
    { key: "scale", label: "Gas scale", min: 0.5, max: 6, step: 0.05, default: 1.8 },
    { key: "warp", label: "Swirl", min: 0, max: 5, step: 0.05, default: 1.6 },
    { key: "bright", label: "Brightness", min: 0.2, max: 3, step: 0.01, default: 1.2 },
    { key: "stars", label: "Star density", min: 4, max: 60, step: 1, default: 18 },
    { key: "starAmt", label: "Star brightness", min: 0, max: 3, step: 0.01, default: 1.0 },
    { key: "rim", label: "Rim glow", min: 0, max: 3, step: 0.01, default: 0.8 },
    { key: "halo", label: "Halo", min: 0, max: 2, step: 0.01, default: 0.5 }
  ],
  colors: [
    { key: "deep", label: "Deep space", default: "#070a24" },
    { key: "gas", label: "Gas", default: "#6c4dff" },
    { key: "hot", label: "Hot gas", default: "#ff7ab6" }
  ],
  statePresets: {
    idle: { speed: 0.2, spin: 0.06, scale: 1.8, warp: 1.6, bright: 1.2, halo: 0.5 },
    // gas knots tighten and swirl
    thinking: { speed: 0.6, spin: 0.25, scale: 2.3, warp: 2.6, bright: 1.2, halo: 0.6 },
    // the galaxy flares
    speaking: { speed: 0.9, spin: 0.1, scale: 1.8, warp: 2.0, bright: 1.6, halo: 0.9 }
  },
  stateColors: {
    idle: { deep: "#070a24", gas: "#6c4dff", hot: "#ff7ab6" },
    thinking: { deep: "#02141c", gas: "#00b8d4", hot: "#b2ff59" },
    speaking: { deep: "#1f0508", gas: "#ff5722", hot: "#ffe082" }
  }
};

export type Orbsy08Props = Omit<ShaderOrbProps, "variant">;

export function Orbsy08({ size = 280, ...rest }: Orbsy08Props) {
  return <ShaderOrb variant={orbsy08Orb} size={size} {...rest} />;
}

export default Orbsy08;
