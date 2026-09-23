/*
 * Orbsy 13 — Quadtree. Original shader, MIT.
 * Not a "use client" module, so server components can read the variant as data.
 * The shader lives in a template literal: its comments must not contain backticks.
 */
import { ShaderOrb, type OrbVariant, type ShaderOrbProps } from "@/components/ui/orbkit-core";
import { ORBSY_GLSL } from "@/components/ui/orbsy-glsl";

/*
  A recursive tile grid wrapped on the ball. Each cube face of the sphere
  carries its own quadtree: at every pixel the cell is descended level by
  level, and it stays whole once the energy sampled at its centre clears a
  threshold that falls with depth. Hot regions (a precessing band plus
  drifting noise blobs) therefore keep big bevelled tiles that burn to white,
  while cool regions shatter into small dim ones, and as the field flows the
  tiles merge and split live. The continuous field also paints a bloom haze in
  the gaps and a halo past the organic rim.
*/
const ORBSY13_FRAG =
  ORBSY_GLSL +
  `
#define QT_LEVELS 5

// Inverse of orbsyCubeUV: face id and face xy back to a unit direction.
vec3 qtCubeDir(float face, vec2 xy) {
  vec3 d;
  if (face < 0.5) d = vec3(1.0, xy.y, xy.x);
  else if (face < 1.5) d = vec3(-1.0, xy.y, -xy.x);
  else if (face < 2.5) d = vec3(xy.x, 1.0, xy.y);
  else if (face < 3.5) d = vec3(xy.x, -1.0, -xy.y);
  else if (face < 4.5) d = vec3(-xy.x, xy.y, 1.0);
  else d = vec3(xy.x, xy.y, -1.0);
  return normalize(d);
}

// Energy on the ball: a ribbon around a precessing great circle, plus two
// octaves of drifting 3D noise. t is a clock, used only as a phase or as a
// translation of the noise domain.
float qtEnergy(vec3 d, float t) {
  vec3 ax = normalize(vec3(0.6 * sin(t * 0.37), 1.0, 0.6 * cos(t * 0.29)));
  float h = dot(d, ax) - 0.3 * sin(t * 0.53);
  float band = exp(-h * h / 0.09);
  float n = noise3(d * 1.7 + vec3(0.0, t * 0.35, t * 0.21)) * 0.67
          + noise3(d * 3.9 + vec3(t * 0.27, 4.1, -t * 0.19)) * 0.33;
  float blob = smoothstep(0.3, 0.85, n);
  float e = max(band * uP_band, blob * uP_blob);
  return e * (1.0 + uP_react * uOutput * 0.7);
}

float qtBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

void main() {
  vec2 uv = orbUV();
  float px = orbsyPx();
  float R = uP_radius * (1.0 + 0.03 * uP_react * uOutput);
  float r = length(uv);
  float t = uP_speed;

  float mask = orbOrganicMask(uv, R, uP_organic, uP_edgeSoft, uP_edgeFlow);
  vec4 s = orbsySphere(orbRimUV(uv, R), R, px);
  vec3 n = s.xyz;

  // Ball space: a fixed tilt, then the spin clock as a rotation phase.
  vec3 nb = n;
  nb.yz = orbsyRot(0.42) * nb.yz;
  nb.xz = orbsyRot(uP_spin) * nb.xz;

  vec3 c = orbsyCubeUV(nb);
  float face = c.z;
  vec2 q = c.xy * 0.5 + 0.5;

  // Pixel footprint in face units: the cube map stretches by up to
  // (1 + |xy|^2) and the sphere foreshortens by 1 / n.z toward the limb.
  float fw = 0.5 * px / R * (1.0 + dot(c.xy, c.xy)) / max(s.z, 0.12);

  // Quadtree descent.
  float grid = floor(uP_grid + 0.5);
  float size = 1.0 / grid;
  vec2 cell = floor(q / size);
  float eC = 0.0;
  float lvl = 0.0;
  for (int l = 0; l < QT_LEVELS; l++) {
    float fl = float(l);
    cell = floor(q / size);
    vec2 ctr = (cell + 0.5) * size;
    eC = qtEnergy(qtCubeDir(face, ctr * 2.0 - 1.0), t);
    float jit = (hash31(vec3(cell, face + fl * 7.0)) - 0.5) * 0.12;
    float th = (1.0 - fl * 0.2) * mix(1.25, 0.55, uP_split) + jit;
    lvl = fl;
    if (eC > th || l == QT_LEVELS - 1) break;
    size *= 0.5;
  }
  float depth = lvl / float(QT_LEVELS - 1);

  // Rounded, bevelled tile with a dark gap.
  vec2 p = (q - (cell + 0.5) * size);
  float gap = uP_gap * (0.004 + 0.035 * size);
  vec2 hb = vec2(0.5 * size - gap);
  float d = qtBox(p, hb, size * 0.16);
  float cov = 1.0 - smoothstep(-fw, fw, d);
  float bev = 1.0 - clamp(-d / (size * 0.14 + fw), 0.0, 1.0);
  float lightSide = dot(normalize(p + 1e-6), vec2(-0.7071, 0.7071));
  float pillow = 1.0 - 0.9 * dot(p, p) / (size * size);
  float shape = pillow * (1.0 + bev * 0.55 * lightSide) * (1.0 - bev * 0.25);

  // A few small tiles twinkle, re-rolled on a stepped clock.
  float tw = step(0.965, hash31(vec3(cell * 1.7, face + floor(t * 4.0 + hash31(vec3(cell, face)) * 7.0))));
  float eT = min(eC, 1.25) * mix(0.8, 0.45, depth) + 0.07 + tw * 0.35 * depth;
  // The pillow also lifts the centre of hot tiles past 1, so they burn white
  // in the middle and stay fluoro at the bevel.
  float core = clamp(1.0 - 3.2 * dot(p, p) / (size * size), 0.0, 1.0);
  vec3 tile = orbsyFluoro(eT * (0.85 + 0.45 * core), uC_deep, uC_base, uC_hot) * shape * cov;

  // Sphere lighting: wrapped diffuse, limb darkening, and a sheen on tiles.
  vec3 L = normalize(vec3(-0.45, 0.55, 0.7));
  float lam = max(dot(n, L) * 0.7 + 0.3, 0.0);
  float spec = pow(max(dot(reflect(-L, n), vec3(0.0, 0.0, 1.0)), 0.0), 20.0);
  // Tiles are emissive, so the lighting only partly shades them.
  vec3 col = tile * mix((0.35 + 0.85 * lam) * mix(0.55, 1.0, s.z), 1.0, 0.35);
  col += vec3(0.75, 1.0, 0.8) * spec * cov * 0.35 * (0.3 + eT);

  // Bloom: the continuous field glows through the gaps and over hot tiles.
  float eP = qtEnergy(nb, t);
  float glow = smoothstep(0.25, 1.2, eP) * uP_bloom;
  col += uC_base * glow * (0.18 + 0.3 * (1.0 - cov)) * (0.5 + 0.5 * lam);
  // Limb light only where the field is hot at that point on the rim: a
  // constant limb term reads as a drawn ring once the bloom lifts it.
  float limb = 1.0 - s.z;
  col += uC_base * limb * limb * limb * 0.3 * glow * glow;

  /*
    Past the rim: bleed tendrils tinted by the field at the rim. orbBleed is
    at full strength right at the rim for every angle (its tendrils only set
    how far each wisp reaches), so on its own it draws a solid ring; a patch
    field that varies in screen space breaks it into separate flares, and the
    uniform halo that used to sit under it is gone for the same reason.
  */
  float rimPatch = smoothstep(0.38, 0.72, orbEdgeFbm(vec3(uv * 3.2, uP_edgeFlow * 0.45)));
  float bl = orbBleed(uv, R, uP_reach, uP_edgeFlow) * uP_bleed * (0.7 + 0.6 * uOutput);
  float heat = 0.25 + glow;
  vec3 outer = uC_base * bl * heat * mix(0.12, 1.0, rimPatch);
  col = col * mask + outer * (1.0 - mask);

  col = orbsyBloomTone(col, uP_exposure);
  gl_FragColor = vec4(col, clamp(max(col.r, max(col.g, col.b)) * 1.2, 0.0, 1.0));
}
`;

export const orbsy13Orb: OrbVariant = {
  key: "orbsy-13",
  label: "Quadtree",
  note: "a recursive tile grid on the sphere's cube faces: big white-hot tiles along a flowing energy band, shattering into small dim ones as it falls off",
  frag: ORBSY13_FRAG,
  params: [
    { key: "speed", label: "Energy flow", min: 0, max: 3, step: 0.01, default: 0.25, integrate: true },
    { key: "spin", label: "Spin rate", min: 0, max: 2, step: 0.01, default: 0.08, integrate: true },
    { key: "radius", label: "Radius", min: 0.3, max: 1, step: 0.01, default: 0.79 },
    { key: "grid", label: "Root tiles", min: 1, max: 4, step: 1, default: 2 },
    { key: "split", label: "Shatter", min: 0, max: 1, step: 0.01, default: 0.45 },
    { key: "band", label: "Band energy", min: 0, max: 2, step: 0.01, default: 1.15 },
    { key: "blob", label: "Blob energy", min: 0, max: 2, step: 0.01, default: 0.75 },
    { key: "gap", label: "Tile gap", min: 0, max: 3, step: 0.01, default: 1.0 },
    { key: "bloom", label: "Bloom", min: 0, max: 2, step: 0.01, default: 0.8 },
    { key: "exposure", label: "Exposure", min: 0.3, max: 3, step: 0.01, default: 1.2 },
    { key: "react", label: "Voice react", min: 0, max: 2, step: 0.01, default: 1.0 },
    { key: "organic", label: "Rim wander", min: 0, max: 0.15, step: 0.005, default: 0.035 },
    { key: "edgeSoft", label: "Rim feather", min: 0, max: 0.2, step: 0.005, default: 0.03 },
    { key: "bleed", label: "Energy bleed", min: 0, max: 3, step: 0.01, default: 0.8 },
    { key: "reach", label: "Bleed reach", min: 0.02, max: 0.5, step: 0.005, default: 0.09 },
    { key: "edgeFlow", label: "Edge flow", min: 0, max: 3, step: 0.01, default: 0.3, integrate: true }
  ],
  colors: [
    { key: "deep", label: "Deep", default: "#010d04" },
    { key: "base", label: "Fluoro", default: "#39ff14" },
    { key: "hot", label: "Hot", default: "#d6ff5c" }
  ],
  statePresets: {
    // one slow band of big tiles, the rest fine and dim
    idle: {
      speed: 0.2, spin: 0.06, split: 0.4, band: 1.1, blob: 0.6, bloom: 0.7, exposure: 1.1,
      react: 0.8, organic: 0.03, bleed: 0.7, reach: 0.08, edgeFlow: 0.25
    },
    // busy: blobs race over the ball, tiles merge and shatter constantly
    thinking: {
      speed: 0.85, spin: 0.2, split: 0.72, band: 0.8, blob: 0.85, bloom: 0.75, exposure: 1.2,
      react: 0.8, organic: 0.045, bleed: 0.9, reach: 0.1, edgeFlow: 0.7
    },
    // brightest: big white tiles pulse with the voice, bloom spilling off the rim
    speaking: {
      speed: 0.55, spin: 0.1, split: 0.3, band: 1.4, blob: 0.95, bloom: 1.2, exposure: 1.45,
      react: 1.4, organic: 0.065, bleed: 1.4, reach: 0.13, edgeFlow: 1.0
    }
  },
  stateColors: {
    idle: { deep: "#010d04", base: "#39ff14", hot: "#d6ff5c" },
    thinking: { deep: "#01100a", base: "#2bff6a", hot: "#c8ffb0" },
    speaking: { deep: "#030f02", base: "#5cff1f", hot: "#eaff7a" }
  }
};

export type Orbsy13Props = Omit<ShaderOrbProps, "variant">;

export function Orbsy13({ size = 280, ...rest }: Orbsy13Props) {
  return <ShaderOrb variant={orbsy13Orb} size={size} {...rest} />;
}

export default Orbsy13;
