/*
 * Orbsy 22 — Prism Glass. Original shader, MIT.
 * An original work inspired by the look of Orbkit's SHDR-01; it shares no code with it.
 * Not a "use client" module, so server components can read the variant as data.
 * The shader lives in a template literal: its comments must not contain backticks.
 */
import { ShaderOrb, type OrbVariant, type ShaderOrbProps } from "@/components/ui/orbkit-core";
import { ORBSY_GLSL } from "@/components/ui/orbsy-glsl";

/*
  An emerald prism. Each pixel's view ray is refracted by the front of a glass
  sphere and marched along its chord through the ball. Inside, a domain-warped
  3D noise field is read as a stack of silk sheets: the iso-surfaces of the
  field, drawn as thin cosine bands, fold wherever the warp does. Light is split
  into four green-family channels (deep emerald, brand green, aqua teal, pale
  mint). Each channel reads the same sheets at a shifted phase, and the shift
  grows with how fast the field changes along the direction the shell bends the
  ray (a two-tap directional derivative), so near the limb and across steep
  folds the colours fan out into striations, and where all four coincide the
  sum burns to white. A smoke field absorbs along the ray, carving dark voids.
  The shell itself adds a limb glow whose colour walks the same green
  spectrum with grazing angle, lit unevenly from a slowly orbiting key, so the
  rim reads as light riding cut glass rather than a drawn ring.
*/
const ORBSY22_FRAG =
  ORBSY_GLSL +
  `
vec3 pgE;
vec3 pgB;
vec3 pgT;
vec3 pgM;
vec3 pgWarp;

// One sheet profile, band-limited: when a march step crosses more of a band
// than it can resolve (blur, in band periods), the sheet fades to its mean
// so thin folds shimmer instead of sparkling.
float pgBlur;
float pgSheet(float x) {
  float s = pow(0.5 + 0.5 * cos(TAU * x), uP_sharp);
  return mix(s, inversesqrt(PI * uP_sharp), smoothstep(0.15, 0.7, pgBlur));
}

// The four channels as a cyclic spectrum: x in [0,1) walks emerald, green,
// teal, mint and back.
vec3 pgSpectrum(float x) {
  vec3 c = pgE * pow(0.5 + 0.5 * cos(TAU * x), 3.0);
  c += pgB * pow(0.5 + 0.5 * cos(TAU * (x - 0.25)), 3.0);
  c += pgT * pow(0.5 + 0.5 * cos(TAU * (x - 0.5)), 3.0);
  c += pgM * pow(0.5 + 0.5 * cos(TAU * (x - 0.75)), 3.0);
  return c;
}

// Sheet coordinate inside the ball. The flow clock only ever translates the
// noise along its own offsets, never scales a position.
float pgField(vec3 p) {
  vec3 q = p * uP_scale;
  float T = uP_speed;
  vec3 w = vec3(
    noise3(q + vec3(0.0, 0.0, T)),
    noise3(q + vec3(5.2, 1.3, T + 3.1)),
    noise3(q + vec3(2.1, 7.7, T + 6.3))
  );
  pgWarp = w;
  q += (w - 0.5) * uP_warp * (1.0 + 0.35 * uOutput);
  float v = noise3(q * 1.4 + vec3(1.7, 9.2, 4.0 + T * 0.6)) * 0.66;
  v += noise3(q * 2.9 + vec3(4.4, 2.2, 13.0 - T * 0.8)) * 0.34;
  return v + p.y * uP_layer;
}

void main() {
  vec2 uv = orbUV();
  float px = orbsyPx();
  float R = uP_radius * (1.0 + 0.025 * uOutput);
  float r = length(uv);
  vec2 us = uv * (min(r, R * 0.998) / max(r, 1e-5));
  vec2 dir = uv / max(r, 1e-5);
  float mask = orbOrganicMask(uv, R, uP_organic, uP_edgeSoft, uP_edgeFlow);
  vec3 n = orbsySphere(us, R, px).xyz;

  // green-family channels from the palette
  pgE = uC_base * vec3(0.05, 0.42, 0.2) + uC_deep;
  pgB = uC_base * vec3(1.35, 1.0, 0.55);
  pgT = vec3(uC_base.r * 0.1, uC_base.g * 0.78, max(uC_base.b * 2.0, uC_base.g * 0.9));
  pgM = uC_hot;

  // ---- refraction into the ball ----
  vec3 D = vec3(0.0, 0.0, -1.0);
  vec3 rd = refract(D, n, 1.0 / uP_ior);
  float chord = max(-2.0 * dot(n, rd), 0.0);
  vec3 bend = rd - D * dot(rd, D);
  float bl = length(bend);
  vec3 dd = bl > 1e-4 ? bend / bl : vec3(1.0, 0.0, 0.0);
  float edge = 1.0 - max(n.z, 0.0);
  float disp = uP_disperse * (0.3 + 0.7 * edge) * (1.0 + 0.6 * uOutput);

  mat2 spin = orbsyRot(uP_spin);
  mat2 tilt = orbsyRot(0.45);
  vec3 dq = dd;
  dq.xz = spin * dq.xz;
  dq.yz = tilt * dq.yz;

  float dt = chord / 34.0;
  float jit = 0.5 + (hash31(vec3(gl_FragCoord.xy, 17.0)) - 0.5) * 0.7;
  float freq = uP_bands * (1.0 + 0.2 * uInput);
  float lift = 1.0 + 0.45 * uOutput;
  vec3 acc = vec3(0.0);
  float Tr = 1.0;
  float phPrev = 0.0;
  for (int i = 0; i < 34; i++) {
    float t = (float(i) + jit) * dt;
    vec3 p = n + rd * t;
    p.xz = spin * p.xz;
    p.yz = tilt * p.yz;
    float v0 = pgField(p);
    vec3 w = pgWarp;
    float v1 = pgField(p + dq * 0.04);
    float g = (v1 - v0) / 0.04;
    float ph = v0 * freq + uP_shimmer;
    pgBlur = i == 0 ? 0.3 : abs(ph - phPrev);
    phPrev = ph;
    float s = uP_split + disp * g * freq;
    // a slow regional tint: some regions lean aqua, others lean lime
    float tint = smoothstep(0.3, 0.7, w.z);
    vec3 e = pgE * pgSheet(ph - 1.5 * s) * 1.6;
    e += pgB * pgSheet(ph - 0.5 * s) * mix(1.3, 0.55, tint);
    e += pgT * pgSheet(ph + 0.5 * s) * mix(0.5, 1.4, tint);
    e += pgM * pgSheet(ph + 1.5 * s) * 0.8;
    // folds are shaded by which way they lean, so the silk reads in relief;
    // light pools in the lit folds and smoke carves voids
    float relief = 0.35 + 0.9 * smoothstep(-2.5, 2.5, g);
    float lit = 0.15 + 0.85 * smoothstep(0.3, 0.75, w.y);
    float dens = uP_smoke * smoothstep(0.4, 0.75, w.x);
    acc += Tr * dt * (e * lit * relief * uP_glow * lift + pgE * 0.18);
    Tr *= exp(-dens * dt * 5.0);
  }

  // ---- the shell: a dispersed limb, lit unevenly ----
  float F = pow(edge, uP_limbPow);
  vec2 key = vec2(cos(uP_spin * 0.7 + 2.2), sin(uP_spin * 0.7 + 2.2));
  float side = 0.5 + 0.5 * dot(dir, key);
  float ln = orbEdgeFbm(vec3(dir * 2.2, uP_edgeFlow * 0.6));
  float rimLocal = mix(0.2, 1.0, side * side) * mix(0.3, 1.25, ln);
  vec3 limbCol = pgSpectrum(edge * 1.3 + ln * 0.8 + uP_shimmer * 0.05);
  vec3 limb = limbCol * F * uP_limb * rimLocal * (1.0 + 0.5 * uOutput) * (0.6 + 0.8 * min(acc.g * uP_exposure, 1.0));

  // a soft window caught on the front of the glass
  vec3 refl = reflect(D, n);
  float glint = pow(max(dot(refl, normalize(vec3(-0.45, 0.6, 0.66))), 0.0), 24.0);
  vec3 inner = acc * uP_exposure + limb + pgM * glint * 0.35 * uP_limb;

  // ---- organic edge: the limb spills past the rim in patches ----
  float bleedF = orbBleed(uv, R, uP_reach, uP_edgeFlow);
  float blotch = mix(0.12, 1.0, smoothstep(0.38, 0.72, orbEdgeFbm(vec3(uv * 3.2, uP_edgeFlow * 0.45))));
  vec3 outer = limbCol * rimLocal * bleedF * blotch * uP_bleed * 0.6 * (1.0 + 0.4 * uOutput);

  vec3 col = inner * mask + outer * (1.0 - mask);
  col = orbsyBloomTone(col, 1.0);
  float a = clamp(max(col.r, max(col.g, col.b)) * 1.2, 0.0, 1.0);
  gl_FragColor = vec4(col, a);
}
`;

export const orbsy22Orb: OrbVariant = {
  key: "orbsy-22",
  label: "Prism Glass",
  note: "an original cut-glass orb whose shell disperses light into emerald striations across smoky silk folds",
  frag: ORBSY22_FRAG,
  params: [
    { key: "speed", label: "Fold flow", min: 0, max: 3, step: 0.01, default: 0.12, integrate: true },
    { key: "spin", label: "Spin rate", min: 0, max: 2, step: 0.01, default: 0.08, integrate: true },
    { key: "shimmer", label: "Band drift", min: 0, max: 3, step: 0.01, default: 0.15, integrate: true },
    { key: "radius", label: "Radius", min: 0.3, max: 1, step: 0.01, default: 0.79 },
    { key: "scale", label: "Fold scale", min: 0.4, max: 4, step: 0.05, default: 1.3 },
    { key: "warp", label: "Fold warp", min: 0, max: 4, step: 0.05, default: 2.0 },
    { key: "layer", label: "Strata", min: 0, max: 1, step: 0.01, default: 0.25 },
    { key: "bands", label: "Sheet count", min: 0.5, max: 8, step: 0.05, default: 2.4 },
    { key: "sharp", label: "Sheet thinness", min: 1, max: 30, step: 0.5, default: 6 },
    { key: "split", label: "Band split", min: 0, max: 0.3, step: 0.005, default: 0.1 },
    { key: "disperse", label: "Dispersion", min: 0, max: 0.3, step: 0.005, default: 0.08 },
    { key: "ior", label: "Glass index", min: 1, max: 2, step: 0.01, default: 1.45 },
    { key: "smoke", label: "Smoke", min: 0, max: 3, step: 0.01, default: 1.2 },
    { key: "glow", label: "Sheet glow", min: 0, max: 3, step: 0.01, default: 1.3 },
    { key: "limb", label: "Limb light", min: 0, max: 3, step: 0.01, default: 1.3 },
    { key: "limbPow", label: "Limb tightness", min: 1, max: 8, step: 0.1, default: 2.4 },
    { key: "exposure", label: "Exposure", min: 0.2, max: 3, step: 0.01, default: 1.35 },
    { key: "organic", label: "Rim wander", min: 0, max: 0.15, step: 0.005, default: 0.025 },
    { key: "edgeSoft", label: "Rim feather", min: 0, max: 0.2, step: 0.005, default: 0.025 },
    { key: "bleed", label: "Energy bleed", min: 0, max: 3, step: 0.01, default: 0.9 },
    { key: "reach", label: "Bleed reach", min: 0.02, max: 0.5, step: 0.005, default: 0.09 },
    { key: "edgeFlow", label: "Edge flow", min: 0, max: 3, step: 0.01, default: 0.3, integrate: true }
  ],
  colors: [
    { key: "deep", label: "Deep", default: "#010f08" },
    { key: "base", label: "Fluoro", default: "#1bd26a" },
    { key: "hot", label: "Hot", default: "#8ff2b8" }
  ],
  statePresets: {
    // calm: slow broad folds, soft sheets, a quiet limb
    idle: {
      speed: 0.12, spin: 0.08, shimmer: 0.15, scale: 1.3, warp: 2.0, layer: 0.25, bands: 2.4, sharp: 7,
      split: 0.1, disperse: 0.08, smoke: 1.0, glow: 1.35, limb: 1.4, limbPow: 2.4, exposure: 1.4,
      bleed: 0.9, reach: 0.09, edgeFlow: 0.3
    },
    // churn: faster flow, more and thinner sheets, tighter striations
    thinking: {
      speed: 0.45, spin: 0.25, shimmer: 0.6, scale: 1.6, warp: 2.6, layer: 0.2, bands: 4.0, sharp: 9,
      split: 0.06, disperse: 0.05, smoke: 1.4, glow: 1.5, limb: 1.1, limbPow: 3, exposure: 1.4,
      bleed: 1.0, reach: 0.1, edgeFlow: 0.6
    },
    // brightest: wide dispersion, glowing limb, voice swells the folds
    speaking: {
      speed: 0.3, spin: 0.12, shimmer: 0.4, scale: 1.2, warp: 2.2, layer: 0.3, bands: 2.8, sharp: 5,
      split: 0.12, disperse: 0.14, smoke: 1.1, glow: 1.4, limb: 1.7, limbPow: 2.2, exposure: 1.4,
      bleed: 1.4, reach: 0.13, edgeFlow: 1.0
    }
  },
  stateColors: {
    idle: { deep: "#010f08", base: "#1bd26a", hot: "#8ff2b8" },
    thinking: { deep: "#010f08", base: "#17cf8c", hot: "#a4f5dc" },
    speaking: { deep: "#01100a", base: "#2ee87c", hot: "#b6ffd2" }
  }
};

export type Orbsy22Props = Omit<ShaderOrbProps, "variant">;

export function Orbsy22({ size = 280, ...rest }: Orbsy22Props) {
  return <ShaderOrb variant={orbsy22Orb} size={size} {...rest} />;
}

export default Orbsy22;
