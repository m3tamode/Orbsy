/*
 * Orbsy 08 — Nebula. Original shader, MIT.
 * Not a "use client" module, so server components can read the variant as data.
 * The shader lives in a template literal: its comments must not contain backticks.
 */
import { ShaderOrb, type OrbVariant, type ShaderOrbProps } from "../core/orbkit-core";
import { ORBSY_GLSL } from "./orbsy-glsl";

/*
  A pocket galaxy: two-level domain-warped 3D fbm on the sphere's normal gives
  swirling gas in three colours, a hashed 3D cell grid scatters twinkling
  stars through it, and limb darkening plus a rim and an outer halo sell the
  ball as a glowing volume rather than a painted disc.
*/
const NEBULA_FRAG =
  ORBSY_GLSL +
  `
float nebulaGas(vec3 p, float t, out float qx) {
  vec3 q = vec3(fbm3(p + vec3(0.0, 0.0, t)), fbm3(p + vec3(5.2, 1.3, -t)), 0.0);
  qx = q.x;
  return fbm3(p + q * uP_warp * (1.0 + 0.5 * uInput) + vec3(t * 0.5));
}

void main() {
  vec2 uv = orbUV();
  float px = orbsyPx();
  float R = uP_radius * (1.0 + 0.04 * uOutput);
  float r = length(uv);
  float t = uP_speed;

  // Organic rim, and the sphere sampled at the rim below any pixel past it.
  float mask = orbOrganicMask(uv, R, uP_organic, uP_edgeSoft, uP_edgeFlow);
  vec4 s = orbsySphere(orbRimUV(uv, R), R, px);

  vec3 n = s.xyz;
  n.xz = orbsyRot(uP_spin) * n.xz;
  float qx;
  float f = nebulaGas(n * uP_scale, t, qx);

  vec3 col = mix(uC_deep, uC_gas, smoothstep(0.2, 0.8, f));
  col = mix(col, uC_hot, smoothstep(0.35, 0.8, f * qx * 1.6));
  col *= uP_bright * (0.8 + 0.4 * uOutput);

  vec3 sp = n * uP_stars;
  vec3 sf = fract(sp) - 0.5;
  float sh = hash31(floor(sp));
  float star = step(0.93, sh) * exp(-dot(sf, sf) * 60.0) * (0.6 + 0.4 * sin(t * 6.0 + sh * 40.0));
  col += vec3(star) * uP_starAmt;

  col *= mix(0.35, 1.0, s.z);
  float limb = 1.0 - s.z;
  col += uC_gas * limb * limb * limb * limb * uP_rim;

  /*
    Gas escaping the ball. Past the rim the same warped field is sampled
    further out along the rim normal and streamed outward by the edge clock,
    so the wisps are the nebula's own structure thinning into space rather
    than a uniform halo. The tendril falloff bounds it before the frame edge.
  */
  float h = max(r - R, 0.0) / R;
  float qo;
  // Sampled in screen space, not along the rim normal: anything that is
  // constant along the radius streaks into spikes. The edge clock enters only
  // through a radial phase, so features drift outward; multiplying a direction
  // by an integrated clock would be a huge radial offset, and rays again.
  vec3 ep = vec3(uv * 1.6 * uP_scale * 0.55, r * 3.0 - uP_edgeFlow * 0.5);
  float fo = nebulaGas(ep, t, qo);
  float wisp = smoothstep(0.4, 0.72, fo);
  vec3 gasCol = mix(uC_gas, uC_hot, smoothstep(0.35, 0.8, fo * qo * 1.6));
  float bleed = orbBleed(uv, R, uP_reach, uP_edgeFlow) * uP_bleed * (0.7 + 0.6 * uOutput);
  vec3 escape = gasCol * bleed * mix(0.25, 1.4, wisp) * (1.0 - mask);

  // Past the rim the ball's own colour (sampled at the rim, so constant along
  // the radius) hands over to the escaping gas, so the wandering edge carries
  // wisps instead of smearing the rim outward into rays.
  vec3 outer = gasCol * mix(0.35, 1.2, wisp) * uP_bright * (0.8 + 0.4 * uOutput);
  col = mix(col, outer, smoothstep(R * 0.97, R * 1.06, r));

  float halo = exp(-max(r - R, 0.0) / (0.06 * uP_halo + 1e-3)) * (1.0 - mask) * uP_halo;
  col = col * mask + uC_gas * halo * 0.6 + escape;
  col = tanh3(col);
  float a = clamp(max(mask, max(halo * 0.6, max(escape.r, max(escape.g, escape.b)))), 0.0, 1.0);
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
    { key: "halo", label: "Halo", min: 0, max: 2, step: 0.01, default: 0.35 },
    { key: "organic", label: "Rim wander", min: 0, max: 0.15, step: 0.005, default: 0.04 },
    { key: "edgeSoft", label: "Rim feather", min: 0, max: 0.2, step: 0.005, default: 0.04 },
    { key: "bleed", label: "Energy bleed", min: 0, max: 3, step: 0.01, default: 1.0 },
    { key: "reach", label: "Bleed reach", min: 0.02, max: 0.5, step: 0.005, default: 0.14 },
    { key: "edgeFlow", label: "Edge flow", min: 0, max: 3, step: 0.01, default: 0.3, integrate: true }
  ],
  colors: [
    { key: "deep", label: "Deep space", default: "#070a24" },
    { key: "gas", label: "Gas", default: "#6c4dff" },
    { key: "hot", label: "Hot gas", default: "#ff7ab6" }
  ],
  statePresets: {
    idle: { speed: 0.2, spin: 0.06, scale: 1.8, warp: 1.6, bright: 1.2, halo: 0.35, organic: 0.035, bleed: 0.9, reach: 0.1, edgeFlow: 0.25 },
    // gas knots tighten and swirl
    thinking: { speed: 0.6, spin: 0.25, scale: 2.3, warp: 2.6, bright: 1.2, halo: 0.4, organic: 0.05, bleed: 1.1, reach: 0.11, edgeFlow: 0.7 },
    // the galaxy flares
    speaking: { speed: 0.9, spin: 0.1, scale: 1.8, warp: 2.0, bright: 1.6, halo: 0.55, organic: 0.07, bleed: 1.5, reach: 0.14, edgeFlow: 1.0 }
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
