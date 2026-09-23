/*
 * Orbsy 03 — Aurora. Original shader, MIT.
 * Not a "use client" module, so server components can read the variant as data.
 * The shader lives in a template literal: its comments must not contain backticks.
 */
import { ShaderOrb, type OrbVariant, type ShaderOrbProps } from "@/components/ui/orbkit-core";
import { ORBSY_GLSL } from "@/components/ui/orbsy-glsl";

/*
  The soft gradient orb of voice-assistant UIs: three coloured blobs orbit
  inside a glassy ball and are layered painter-style over a base colour, all
  sampled through an fbm domain warp so the colours smear like liquid. Sphere
  shading, a rim light and one specular highlight make it a body, not a disc.
*/
const AURORA_FRAG =
  ORBSY_GLSL +
  `
vec3 auroraFluid(vec2 uv) {
  vec2 w = uv * uP_warpScale;
  vec2 q = vec2(fbm(w + vec2(0.0, uP_speed)), fbm(w + vec2(5.2, -uP_speed * 0.8)));
  vec2 p = uv + (q - 0.5) * uP_warp * (1.0 + 0.6 * uInput);

  float t = uP_orbit;
  vec2 b1 = vec2(cos(t), sin(t * 1.3)) * uP_spread;
  vec2 b2 = vec2(cos(t * 0.8 + 2.1), sin(t * 1.1 + 2.1)) * uP_spread;
  vec2 b3 = vec2(cos(-t * 1.2 + 4.2), sin(t * 0.7 + 4.2)) * uP_spread;
  float s2 = uP_blobSize * uP_blobSize * (1.0 + 0.5 * uOutput);

  vec3 col = uC_base;
  col = mix(col, uC_c1, exp(-dot(p - b1, p - b1) / s2));
  col = mix(col, uC_c2, exp(-dot(p - b2, p - b2) / s2));
  col = mix(col, uC_c3, exp(-dot(p - b3, p - b3) / s2));
  return col;
}

void main() {
  vec2 uv = orbUV();
  float R = uP_radius * (1.0 + uP_pulse * uOutput);
  float r = length(uv);

  // Organic rim: the silhouette wanders and feathers instead of a hard cut.
  float mask = orbOrganicMask(uv, R, uP_organic, uP_edgeSoft, uP_edgeFlow);

  // Pixels past the true radius take the fluid's colour from the rim below
  // them, so the lumps and the bleed carry the blobs that touch the edge.
  vec2 rimUv = orbRimUV(uv, R);
  vec3 fluid = auroraFluid(rimUv);

  vec3 col = fluid;
  float z = sqrt(max(R * R - r * r, 0.0)) / R;
  col *= mix(uP_rimDark, 1.0, sqrt(z));
  float edge = 1.0 - z;
  vec3 rimLight = mix(uC_c1, uC_c2, 0.5);
  col += edge * edge * edge * uP_rim * rimLight;

  vec2 hl = uv - vec2(-0.32, 0.38) * R;
  col += exp(-dot(hl, hl) / (0.06 * R * R)) * uP_gloss;
  col = clamp(col, 0.0, 1.0);

  // Energy creeping out past the rim, in the colour of the fluid behind it.
  float bleed = orbBleed(uv, R, uP_reach, uP_edgeFlow) * uP_bleed * (0.7 + 0.6 * uOutput);
  vec3 glow = (fluid + rimLight * 0.35) * bleed * (1.0 - mask);
  float glowA = clamp(max(glow.r, max(glow.g, glow.b)), 0.0, 1.0);

  gl_FragColor = vec4(col * mask + glow, max(mask, glowA));
}
`;

export const orbsy03Orb: OrbVariant = {
  key: "orbsy-03",
  label: "Aurora",
  note: "three liquid colour blobs orbiting inside a glassy voice-assistant orb",
  frag: AURORA_FRAG,
  params: [
    { key: "speed", label: "Warp speed", min: 0, max: 3, step: 0.01, default: 0.25, integrate: true },
    { key: "orbit", label: "Orbit rate", min: 0, max: 3, step: 0.01, default: 0.3, integrate: true },
    { key: "radius", label: "Radius", min: 0.3, max: 1, step: 0.01, default: 0.8 },
    { key: "pulse", label: "Voice pulse", min: 0, max: 0.3, step: 0.005, default: 0.05 },
    { key: "warpScale", label: "Warp scale", min: 0.2, max: 5, step: 0.05, default: 1.6 },
    { key: "warp", label: "Warp amount", min: 0, max: 1.5, step: 0.01, default: 0.4 },
    { key: "spread", label: "Orbit spread", min: 0, max: 1, step: 0.01, default: 0.45 },
    { key: "blobSize", label: "Blob size", min: 0.1, max: 1, step: 0.01, default: 0.42 },
    { key: "rimDark", label: "Limb darkening", min: 0, max: 1, step: 0.01, default: 0.55 },
    { key: "rim", label: "Rim light", min: 0, max: 2, step: 0.01, default: 0.45 },
    { key: "gloss", label: "Gloss", min: 0, max: 1, step: 0.01, default: 0.25 },
    { key: "organic", label: "Rim wander", min: 0, max: 0.15, step: 0.005, default: 0.04 },
    { key: "edgeSoft", label: "Rim feather", min: 0, max: 0.2, step: 0.005, default: 0.035 },
    { key: "bleed", label: "Energy bleed", min: 0, max: 3, step: 0.01, default: 0.9 },
    { key: "reach", label: "Bleed reach", min: 0.02, max: 0.5, step: 0.005, default: 0.12 },
    { key: "edgeFlow", label: "Edge flow", min: 0, max: 3, step: 0.01, default: 0.35, integrate: true }
  ],
  colors: [
    { key: "base", label: "Base", default: "#0b0620" },
    { key: "c1", label: "Blob 1", default: "#ff4fd8" },
    { key: "c2", label: "Blob 2", default: "#4f7bff" },
    { key: "c3", label: "Blob 3", default: "#34f5c5" }
  ],
  statePresets: {
    idle: { speed: 0.25, orbit: 0.3, warp: 0.4, spread: 0.45, blobSize: 0.42, organic: 0.03, bleed: 0.7, reach: 0.1, edgeFlow: 0.3 },
    // blobs pull in tight and chase each other
    thinking: { speed: 0.6, orbit: 1.1, warp: 0.7, spread: 0.3, blobSize: 0.32, organic: 0.05, bleed: 0.9, reach: 0.12, edgeFlow: 0.8 },
    // blobs swell and fill the ball
    speaking: { speed: 0.9, orbit: 0.7, warp: 0.55, spread: 0.5, blobSize: 0.52, organic: 0.06, bleed: 1.3, reach: 0.16, edgeFlow: 1.1 }
  },
  stateColors: {
    idle: { base: "#0b0620", c1: "#ff4fd8", c2: "#4f7bff", c3: "#34f5c5" },
    thinking: { base: "#05081a", c1: "#8a5cff", c2: "#2ad4ff", c3: "#c6f0ff" },
    speaking: { base: "#1a0610", c1: "#ff7a3d", c2: "#ff2e88", c3: "#ffd23f" }
  }
};

export type Orbsy03Props = Omit<ShaderOrbProps, "variant">;

export function Orbsy03({ size = 280, ...rest }: Orbsy03Props) {
  return <ShaderOrb variant={orbsy03Orb} size={size} {...rest} />;
}

export default Orbsy03;
