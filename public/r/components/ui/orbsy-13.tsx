/*
 * Orbsy 13 — Menger Core. Original shader, MIT.
 * Not a "use client" module, so server components can read the variant as data.
 * The shader lives in a template literal: its comments must not contain backticks.
 */
import { ShaderOrb, type OrbVariant, type ShaderOrbProps } from "@/components/ui/orbkit-core";
import { ORBSY_GLSL } from "@/components/ui/orbsy-glsl";

/*
  A recursive grid in true 3D: a Menger sponge (a cube hollowed three times
  over, the classic fold SDF) turning inside a glass ball. The sponge is a
  little larger than the ball and intersected with it, so the silhouette is
  the sphere and its surface is a spherical cut through the sponge, pierced
  by square holes at three scales.

  - SHADING: the outer faces are near black with a faint ordered dither. The
    edges glow fluoro: every sponge face is axis aligned in the sponge's own
    frame, so a normal taken at a wider epsilon (about a line width) leaves
    the axes only near a crease, convex or concave. On the spherical cut the
    edge is simply where the sponge distance is near zero.
  - THE CORE: a white-hot light sits at the centre. Faces that look back at
    it are lit, and the march integrates a volumetric glow around it, so
    light leaks out only where a ray threads the holes toward the middle.
  - SCAN: a plane sweeps through the sponge's own y axis, stepping layer by
    layer on the level-3 grid, and every face and edge in the current slab
    flares.
  - GLASS: a crisp window-shaped specular and a faint fresnel, broken into
    patches so it never draws a ring. Past the rim, bleed takes its colour
    from the march at the rim, masked by a screen-space patch field.
*/
const ORBSY13_FRAG =
  ORBSY_GLSL +
  `
#define MG_STEPS 60
#define MG_CAM 4.0

mat3 mgRot;
float mgScanY;
float mgCore;

float mgBox(vec3 p, float b) {
  vec3 q = abs(p) - b;
  return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
}

// Sponge of half-size 1 in its own frame.
float mgSponge(vec3 p) {
  float d = mgBox(p, 1.0);
  float s = 1.0;
  for (int m = 0; m < 3; m++) {
    vec3 a = mod(p * s, 2.0) - 1.0;
    s *= 3.0;
    vec3 r = abs(1.0 - 3.0 * abs(a));
    float da = max(r.x, r.y);
    float db = max(r.y, r.z);
    float dc = max(r.z, r.x);
    float c = (min(da, min(db, dc)) - 1.0) / s;
    d = max(d, c);
  }
  return d;
}

// World: ball of radius 1 intersected with the turning sponge.
float mgMap(vec3 p) {
  vec3 q = mgRot * p;
  float S = uP_size;
  return max(mgSponge(q / S) * S, length(p) - 1.0);
}

// Normal with a wider epsilon: on the sponge every face is axis aligned in
// its own frame, so wherever this normal is not, the point is within reach of
// a crease (convex or concave).
vec3 mgNormalWide(vec3 p, float h) {
  vec2 e = vec2(h, -h);
  return normalize(
    e.xyy * mgMap(p + e.xyy) + e.yyx * mgMap(p + e.yyx) +
    e.yxy * mgMap(p + e.yxy) + e.xxx * mgMap(p + e.xxx));
}

// Core glow density at a point.
float mgGlow(vec3 p) {
  float r2 = dot(p, p);
  return exp(-r2 * 10.0) * 2.4 + exp(-r2 * 3.0) * 0.08;
}

// March one screen position; returns energy (x), bloom energy (y), and
// whether the ball was hit at all (z).
vec3 mgScene(vec2 suv, float R, float px, vec2 fc) {
  float focal = R * sqrt(MG_CAM * MG_CAM - 1.0);
  vec3 ro = vec3(0.0, 0.0, MG_CAM);
  vec3 rd = normalize(vec3(suv, -focal));
  float b = dot(ro, rd);
  float h = b * b - (dot(ro, ro) - 1.0);
  if (h < 0.0) return vec3(0.0);
  h = sqrt(h);
  float t0 = -b - h;
  float t1 = -b + h;
  float t = t0;
  float glow = 0.0;
  float hit = 0.0;
  for (int i = 0; i < MG_STEPS; i++) {
    vec3 p = ro + rd * t;
    float d = mgMap(p);
    if (d < 0.0012) { hit = 1.0; break; }
    float dt = max(d, 0.004);
    glow += mgGlow(p) * dt;
    t += dt;
    if (t > t1) break;
  }

  vec3 p = ro + rd * t;
  float E = 0.0;
  float bloomE = glow * mgCore * 0.6;
  // Volumetric leak from the core.
  E += glow * mgCore;
  if (hit > 0.5) {
    vec3 q = mgRot * p;
    float rr = length(p);
    float dSp = mgSponge(q / uP_size) * uP_size;
    float onBall = step(dSp, rr - 1.0);
    float ew = uP_lineW * px * 1.4;
    vec3 n;
    float edge;
    if (onBall > 0.5) {
      // the spherical cut: edges are where the sponge's own surface meets it
      n = p / max(rr, 1e-4);
      edge = 1.0 - smoothstep(0.0, ew, abs(dSp));
    } else {
      n = mgNormalWide(p, ew);
      vec3 nq = abs(mgRot * n);
      edge = 1.0 - smoothstep(0.93, 0.995, max(nq.x, max(nq.y, nq.z)));
    }
    // light from the centre, falling off with distance
    float toC = max(dot(n, -p / max(rr, 1e-3)), 0.0);
    float lit = toC * mgCore * 1.3 / (1.0 + 10.0 * rr * rr);
    // key light from upper left for a hint of form on the dark faces
    float key = max(dot(n, normalize(vec3(-0.5, 0.6, 0.65))), 0.0);
    // depth: faces deep inside the holes are further from the surface
    float deep = smoothstep(0.95, 0.35, rr);
    // scan slab on the sponge's own y, stepped on the level-3 grid
    float cellY = (floor((q.y / uP_size + 1.0) * 13.5) + 0.5) / 13.5 - 1.0;
    float dy = mgScanY - cellY;
    float slab = exp(-dy * dy * 160.0);
    // layers already swept keep a fading afterglow
    float trail = dy > 0.0 ? exp(-dy * 3.5) * 0.45 : 0.0;
    float scanE = (slab + trail) * uP_scan;

    float face = uP_face * (0.015 + 0.08 * key) * (1.0 - 0.6 * deep);
    // faint dither on the faces
    float bay = orbsyBayer8(floor(fc * 0.5));
    face = floor(face * 14.0 + bay) / 14.0 * 0.8 + face * 0.2;
    float edgeE = edge * uP_edge * (0.55 + 0.9 * lit + 0.5 * deep) * (1.0 - 0.6 * deep * (1.0 - lit));
    E += face + lit + edgeE + scanE * (0.18 + 1.6 * edge) + slab * uP_scan * 0.25;
    bloomE += lit * 0.5 + edgeE * 0.25 + scanE * 0.3;
  }
  return vec3(E, bloomE, 1.0);
}

void main() {
  vec2 uv = orbUV();
  float px = orbsyPx();
  vec2 fc = orbFragCoord(uv);
  float R = uP_radius * (1.0 + 0.025 * uP_react * uOutput);
  float r = length(uv);

  // Sponge orientation: a tilt that nods on a phase, then the spin clock.
  mat2 ra = orbsyRot(uP_spin);
  mat2 rb = orbsyRot(uP_tilt + 0.18 * sin(uP_spin * 0.61));
  mat3 my = mat3(ra[0][0], 0.0, ra[0][1], 0.0, 1.0, 0.0, ra[1][0], 0.0, ra[1][1]);
  mat3 mx = mat3(1.0, 0.0, 0.0, 0.0, rb[0][0], rb[0][1], 0.0, rb[1][0], rb[1][1]);
  mgRot = my * mx;

  // Scan plane position in sponge units, sweeping bottom to top.
  mgScanY = fract(uP_scanRate * 0.23) * 2.4 - 1.2;
  float beat = 0.5 + 0.5 * sin(uP_beat);
  mgCore = uP_core * (1.0 + uP_pulse * beat) * (1.0 + uP_react * (1.6 * uOutput + 0.4 * uInput));

  float mask = orbOrganicMask(uv, R, uP_organic, uP_edgeSoft, uP_edgeFlow);
  vec2 suv = orbRimUV(uv, R);
  vec3 S = mgScene(suv, R, px, fc);

  vec3 col = orbsyFluoro(S.x, uC_deep, uC_base, uC_hot);
  col += uC_base * S.y * uP_bloom * 0.35;

  // Glass shell: a sharp window reflection and a patchy fresnel.
  vec4 sp = orbsySphere(suv, R, px);
  vec3 n = sp.xyz;
  vec3 rf = reflect(vec3(0.0, 0.0, -1.0), n);
  float win = smoothstep(0.1, 0.06, abs(rf.x + 0.42)) * smoothstep(0.1, 0.06, abs(rf.y - 0.5));
  win *= step(0.012, abs(rf.x + 0.42)) * step(0.012, abs(rf.y - 0.5)) * 0.5 + 0.5;
  float rimPatch = smoothstep(0.38, 0.72, orbEdgeFbm(vec3(uv * 3.2, uP_edgeFlow * 0.45)));
  float fres = pow(1.0 - sp.z, 4.0);
  col += mix(uC_hot, vec3(1.0), 0.5) * win * uP_glass * 0.9;
  col += uC_base * fres * uP_glass * 0.3 * mix(0.1, 1.0, rimPatch) * (0.3 + S.x);

  // Past the rim: bleed coloured by the march at the rim, broken into patches.
  float bl = orbBleed(uv, R, uP_reach, uP_edgeFlow) * uP_bleed * (0.7 + 0.6 * uOutput);
  vec3 outer = uC_base * bl * smoothstep(0.25, 1.6, S.x + S.y * uP_bloom) * 0.8 * mix(0.08, 1.0, rimPatch);
  col = col * mask + outer * (1.0 - mask);

  col = orbsyBloomTone(col, uP_exposure);
  gl_FragColor = vec4(col, clamp(max(col.r, max(col.g, col.b)) * 1.2, 0.0, 1.0));
}
`;

export const orbsy13Orb: OrbVariant = {
  key: "orbsy-13",
  label: "Menger Core",
  note: "a raymarched Menger sponge turning inside a glass ball, fluoro edges on dark dithered faces, white-hot light leaking from a core through the holes",
  frag: ORBSY13_FRAG,
  params: [
    { key: "spin", label: "Turn rate", min: 0, max: 2, step: 0.01, default: 0.1, integrate: true },
    { key: "scanRate", label: "Scan rate", min: 0, max: 4, step: 0.01, default: 0.3, integrate: true },
    { key: "beat", label: "Core beat", min: 0, max: 12, step: 0.05, default: 1.0, integrate: true },
    { key: "radius", label: "Radius", min: 0.3, max: 1, step: 0.01, default: 0.79 },
    { key: "size", label: "Sponge size", min: 0.8, max: 1.6, step: 0.01, default: 1.12 },
    { key: "tilt", label: "Tilt", min: 0, max: 1.6, step: 0.01, default: 0.62 },
    { key: "core", label: "Core light", min: 0, max: 4, step: 0.01, default: 1.0 },
    { key: "pulse", label: "Beat depth", min: 0, max: 2, step: 0.01, default: 0.2 },
    { key: "edge", label: "Edge glow", min: 0, max: 3, step: 0.01, default: 1.0 },
    { key: "lineW", label: "Edge width", min: 0.5, max: 4, step: 0.05, default: 1.6 },
    { key: "face", label: "Face fill", min: 0, max: 2, step: 0.01, default: 1.0 },
    { key: "scan", label: "Scan plane", min: 0, max: 3, step: 0.01, default: 0 },
    { key: "glass", label: "Glass", min: 0, max: 2, step: 0.01, default: 0.7 },
    { key: "bloom", label: "Bloom", min: 0, max: 2, step: 0.01, default: 0.8 },
    { key: "exposure", label: "Exposure", min: 0.3, max: 3, step: 0.01, default: 1.1 },
    { key: "react", label: "Voice react", min: 0, max: 2, step: 0.01, default: 1.0 },
    { key: "organic", label: "Rim wander", min: 0, max: 0.15, step: 0.005, default: 0.03 },
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
    // slow turn, the core a dim ember deep in the holes, no scan
    idle: {
      spin: 0.08, scanRate: 0.3, beat: 0.8, core: 0.7, pulse: 0.15, edge: 0.9, face: 1.0, scan: 0,
      glass: 0.6, bloom: 0.7, exposure: 1.05, react: 0.8, organic: 0.03, bleed: 0.6, reach: 0.08, edgeFlow: 0.25
    },
    // faster turn, a scanning plane lighting the sponge layer by layer
    thinking: {
      spin: 0.3, scanRate: 1.6, beat: 2.0, core: 0.9, pulse: 0.2, edge: 1.2, face: 0.9, scan: 1.4,
      glass: 0.7, bloom: 0.85, exposure: 1.15, react: 0.8, organic: 0.045, bleed: 0.9, reach: 0.1, edgeFlow: 0.7
    },
    // hot light pouring through the holes, pulsing with the voice
    speaking: {
      spin: 0.14, scanRate: 0.5, beat: 3.5, core: 2.0, pulse: 0.5, edge: 1.3, face: 1.0, scan: 0,
      glass: 0.8, bloom: 1.3, exposure: 1.3, react: 1.4, organic: 0.065, bleed: 1.4, reach: 0.13, edgeFlow: 1.0
    }
  },
  stateColors: {
    idle: { deep: "#010d04", base: "#39ff14", hot: "#d6ff5c" },
    thinking: { deep: "#01100a", base: "#2bff6a", hot: "#c4ffd0" },
    speaking: { deep: "#030f02", base: "#5cff1f", hot: "#eaff80" }
  }
};

export type Orbsy13Props = Omit<ShaderOrbProps, "variant">;

export function Orbsy13({ size = 280, ...rest }: Orbsy13Props) {
  return <ShaderOrb variant={orbsy13Orb} size={size} {...rest} />;
}

export default Orbsy13;
