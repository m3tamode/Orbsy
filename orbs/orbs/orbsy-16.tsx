/*
 * Orbsy 16 — Green Galaxy. Original shader, MIT.
 * Derived from Orbkit's SHDR-32 (MIT): the galaxy march, its density model,
 * the plane-hit star lattice and the spilling envelope are that orb's.
 * Not a "use client" module, so server components can read the variant as data.
 * The shader lives in a template literal: its comments must not contain backticks.
 */
import { ShaderOrb, type OrbVariant, type ShaderOrbProps } from "../core/orbkit-core";
import { ORBSY_GLSL } from "./orbsy-glsl";

/*
  A galaxy marched as gas and dust inside the ball, read out on a phosphor
  screen.

  - THE MARCH is SHDR-32's: a flared exponential disc with a Gaussian bulge,
    log-spiral arms (N * phi - k * log(rho), N pinned to an integer),
    feedback-curl turbulence thresholded into clumps and fraying the arms,
    and dust as extinction front-to-back. Here the emission is a scalar
    ENERGY rather than a colour ramp, with the bulge accumulated separately,
    so the arms ride the fluoro ramp (orbsyFluoro) and the core burns white.
  - THE EDGE is SHDR-32's spill: the march envelope reaches past the ball
    along the arms and in clumps streaming out on the edge-flow clock, so
    arm gas spills over a wandering, feathered rim (orbOrganicMask), with a
    tendril glow (orbBleed) past it.
  - STAR KNOTS are hashed on the ray's analytic hit with the galactic plane,
    drawn as tiny plus-shaped glyphs, white-hot, veiled by the dust.
  - A POLAR CHART is etched on the same plane: range rings and bearing
    spokes at a constant pixel width (finite differences of the plane
    coordinates one pixel over) that stay fixed while the disc turns under
    them, plus an expanding ping ring on its own clock.
  - BLOOM is analytic: a two-lobe glow around the core and a broad, low
    frequency copy of the arm pattern on the plane. CRT: fine scanlines and
    an aperture-grille mask before orbsyBloomTone.
*/
const ORBSY16_FRAG =
  ORBSY_GLSL +
  `
#define GG_STEPS 56
#define GG_TURB 4
#define GG_CAM 7.0
#define GG_FOCAL 2.25

float ggDensity;
float ggCore;
float ggFalloff;
float ggEnv;

// The galactic density in the galaxy's own frame (disc in xz, normal y).
float ggGalaxy(vec3 p, float t, out float arm, out float rho, out float turb) {
  rho = length(p.xz);
  float h = p.y;
  float phi = rho > 1e-4 ? atan(p.z, p.x) : 0.0;
  float lr = log(max(rho, 0.02));
  float armPhase = phi * uP_arms - uP_wind * lr;

  vec3 q = p * uP_turbScale;
  float f = 1.0;
  for (int k = 0; k < GG_TURB; k++) {
    q += cos(q.yzx * f + t) / f;
    f *= 1.9;
  }
  float n = (sin(q.x) + sin(q.y) + sin(q.z)) / 3.0 * 0.5 + 0.5;
  float clump = smoothstep(uP_threshold, 1.0, n);
  turb = n;

  arm = 0.5 + 0.5 * cos(armPhase + (n - 0.5) * uP_ragged);
  arm = pow(arm, uP_armSharp);

  float scaleH = uP_thick * (0.12 + rho);
  float disc = exp(-rho * ggFalloff) * exp(-abs(h) / scaleH);
  float bulge = exp(-dot(p, p) * uP_bulge);
  return disc * (0.08 + 1.6 * arm) * (0.25 + 0.75 * clump) * ggDensity + bulge * ggCore * ggDensity;
}

/*
  Star knots: one hashed lattice, each live cell a small plus glyph at a
  hashed position with its own twinkle. The 3x3 gather keeps glyphs near a
  cell wall whole.
*/
float ggStars(vec2 p, float density, float twinkleT) {
  vec2 id = floor(p);
  vec2 fr = fract(p);
  float acc = 0.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 o = vec2(float(i), float(j));
      vec2 cid = id + o;
      float h = hash(cid);
      if (h > density) continue;
      vec2 d = abs(fr - o - vec2(0.2, 0.2) - 0.6 * vec2(hash(cid + 1.3), hash(cid + 2.7)));
      float sz = 0.1 + 0.16 * hash(cid + 8.9);
      float w = 0.028;
      float bar = max(step(d.x, w) * step(d.y, sz), step(d.y, w) * step(d.x, sz));
      float dotc = exp(-dot(d, d) / (0.004));
      float tw = 0.5 + 0.5 * sin(twinkleT * (1.5 + 5.0 * hash(cid + 5.1)) + h * 40.0);
      acc += (bar * 0.8 + dotc * 0.6) * (0.35 + 0.65 * tw) * (0.5 + 0.5 * h / max(density, 0.001));
    }
  }
  return acc;
}

/*
  The ray through screen point p meets the (tilted, unspun) galactic plane
  at the returned point, in units of the envelope radius; w is 1 on a hit.
*/
vec3 ggPlane(vec2 p, out float hit) {
  vec3 ro = vec3(0.0, 0.0, GG_CAM);
  vec3 rd = normalize(vec3(p, -GG_FOCAL));
  float ct = cos(uP_tilt);
  float st = sin(uP_tilt);
  // the disc normal of the march frame, so the chart lies in the gas
  vec3 N = vec3(0.0, ct, -st);
  float denom = dot(N, rd);
  hit = 0.0;
  if (abs(denom) < 1e-4) return vec3(0.0);
  float th = -dot(N, ro) / denom;
  if (th <= 0.0) return vec3(0.0);
  hit = 1.0;
  vec3 q = ro + rd * th;
  return vec3(q.x, q.y * ct - q.z * st, q.y * st + q.z * ct) / ggEnv;
}

// energy of the arm gas (x), bulge (y) and opacity (z)
vec3 ggMarch(vec2 uv, vec2 fragCoord) {
  vec3 ro = vec3(0.0, 0.0, GG_CAM);
  vec3 rd = normalize(vec3(uv, -GG_FOCAL));
  float t = uP_churn;
  float ct = cos(uP_tilt);
  float st = sin(uP_tilt);
  float cs = cos(uP_spin);
  float sn = sin(uP_spin);

  float E = 0.0;
  float C = 0.0;
  float T = 1.0;

  float spill = max(uP_spill - 1.0, 0.0) * (0.8 + 0.5 * uOutput);
  float envMax = ggEnv * (1.0 + spill);
  float z = max(GG_CAM - envMax * 1.05, 0.0);
  float zEnd = GG_CAM + envMax * 1.05;
  float dt = (zEnd - z) / float(GG_STEPS);
  z += dt * hash(fragCoord * 0.37);

  for (int i = 0; i < GG_STEPS; i++) {
    vec3 p = ro + rd * z;
    float rp = length(p);
    if (rp < envMax) {
      vec3 g = vec3(p.x, p.y * ct - p.z * st, p.y * st + p.z * ct);
      g = vec3(g.x * cs - g.z * sn, g.y, g.x * sn + g.z * cs);
      float arm = 0.0;
      float rho = 0.0;
      float turb = 0.0;
      float d = ggGalaxy(g / ggEnv, t, arm, rho, turb);

      float rOut = ggEnv;
      if (spill > 0.0 && rp > ggEnv * 0.85) {
        vec3 dir = p / rp;
        float wn = orbEdgeNoise(dir * 3.0 + vec3(0.0, 0.0, rp / ggEnv * 4.0 - uP_edgeFlow * 1.5));
        float reachW = (0.25 + 0.75 * arm) * (0.5 + turb) * smoothstep(0.2, 0.8, wn);
        rOut += ggEnv * spill * clamp(reachW * 1.5, 0.0, 1.2);
      }
      d *= 1.0 - smoothstep(ggEnv * 0.92, rOut, rp);

      float coreW = exp(-rho * rho * uP_bulge * 0.6);
      // the outer arms run a little cooler than the inner ones
      float armE = (0.6 + 0.6 * arm) * mix(1.0, 0.65, smoothstep(0.15, 0.8, rho));
      E += T * d * armE * (1.0 - coreW) * dt;
      // the arm term reaches into the bulge too, so the core shows a swirl
      C += T * d * coreW * (0.35 + 0.9 * arm) * dt;
      T *= exp(-d * uP_absorb * dt);
    }
    z += dt;
    if (T < 0.004 || z > zEnd) break;
  }
  return vec3(E, C, 1.0 - T);
}

void main() {
  vec2 uv = orbUV();
  float px = orbsyPx();
  float r = length(uv);
  float R = uP_radius;
  // the envelope radius that projects to R on screen
  ggEnv = R * GG_CAM / sqrt(GG_FOCAL * GG_FOCAL + R * R);

  float wave = 0.5 + 0.5 * cos(uP_beat);
  ggDensity = uP_density * (1.0 + 0.35 * uInput);
  ggCore = uP_core * (1.0 + 0.7 * uOutput) * (1.0 + uP_pulse * wave);
  ggFalloff = uP_falloff / (1.0 + uP_breathe * wave);

  vec3 m = ggMarch(uv, gl_FragCoord.xy);
  float veil = 1.0 - m.z;

  // arm gas on the fluoro ramp, the bulge burning white
  // a contrast curve first, so faint gas falls to the night and the arms
  // stand out of it
  float eg = m.x * uP_gain;
  eg = eg * eg / (eg + uP_contrast);
  // the bulge shares the ramp, so it is green where thin and burns through
  // hot to white only where it is dense
  float ec = m.y * uP_gain * 0.7;
  vec3 col = orbsyFluoro(eg * (1.0 + uP_contrast) + ec, uC_deep, uC_base, uC_hot);
  col += vec3(0.9, 1.0, 0.85) * max(ec - 0.5, 0.0) * 0.6;

  // ---- the plane: star knots, the polar chart, arm bloom
  float hit = 0.0;
  float hx = 0.0;
  float hy = 0.0;
  vec3 g = ggPlane(uv, hit);
  vec3 gx = ggPlane(uv + vec2(px, 0.0), hx);
  vec3 gy = ggPlane(uv + vec2(0.0, px), hy);
  float bloomArms = 0.0;
  if (hit > 0.5 && hx > 0.5 && hy > 0.5) {
    vec2 c0 = g.xz;
    float rho = length(c0);
    float cs = cos(uP_spin);
    float sn = sin(uP_spin);
    vec2 sp = vec2(c0.x * cs - c0.y * sn, c0.x * sn + c0.y * cs);
    float phi = rho > 1e-4 ? atan(sp.y, sp.x) : 0.0;
    float armW = 0.5 + 0.5 * cos(phi * uP_arms - uP_wind * log(max(rho, 0.02)));

    // star knots ride the turning disc, a sprinkle out past the rim
    float starOut = 1.0 - smoothstep(0.95, 0.95 * max(uP_spill, 1.0) + 1e-3, rho);
    float sf = ggStars(sp * uP_starScale, uP_starDensity * (0.25 + 0.75 * armW), uP_twinkle);
    col += vec3(0.92, 1.0, 0.85) * sf * uP_stars * exp(-rho * 1.2) * (0.3 + 0.7 * veil) * starOut;

    // the chart: fixed on the tilted plane, the disc turns beneath it
    float rhoX = length(gx.xz) - rho;
    float rhoY = length(gy.xz) - rho;
    float gradR = max(length(vec2(rhoX, rhoY)), 1e-5);
    float ringF = abs(fract(rho * 4.0 + 0.5) - 0.5) / 4.0;
    float rings = (1.0 - smoothstep(0.3, 1.1, ringF / gradR)) * step(rho, 1.02) * step(0.2, rho);
    float ang = atan(c0.y, c0.x);
    float angX = atan(gx.z, gx.x) - ang;
    float angY = atan(gy.z, gy.x) - ang;
    angX -= TAU * floor(angX / TAU + 0.5);
    angY -= TAU * floor(angY / TAU + 0.5);
    float spokeF = abs(fract(ang / (PI / 6.0) + 0.5) - 0.5) * (PI / 6.0);
    float spokes = (1.0 - smoothstep(0.3, 1.1, spokeF / max(length(vec2(angX, angY)), 1e-5)));
    spokes *= smoothstep(0.2, 0.3, rho) * step(rho, 1.0);
    // dashed spokes: a radar chart, not a wheel
    spokes *= step(0.4, fract(rho * 20.0));
    // bearing ticks on the outer ring
    float tickF = abs(fract(ang / (PI / 36.0) + 0.5) - 0.5) * (PI / 36.0);
    float ticks = (1.0 - smoothstep(0.3, 1.1, tickF / max(length(vec2(angX, angY)), 1e-5)));
    ticks *= step(0.96, rho) * step(rho, 1.0);
    // the ping, expanding on its own clock
    float pr = fract(uP_scan * 0.25) * 1.15;
    float ping = (1.0 - smoothstep(0.5, 2.0, abs(rho - pr) / gradR)) * (1.0 - smoothstep(0.7, 1.15, pr));
    float pingWake = exp(-max(pr - rho, 0.0) * 12.0) * step(rho, pr) * (1.0 - smoothstep(0.7, 1.15, pr)) * step(0.05, pr);
    float chart = (rings * 0.8 + spokes * 0.5 + ticks) * uP_grid * (0.4 + 0.6 * veil);
    chart += (ping * 0.7 + pingWake * 0.1) * uP_ping;
    col += orbsyFluoro(chart, uC_deep, uC_base, uC_hot) * step(0.001, chart);

    // arm bloom: a broad copy of the arm pattern
    bloomArms = pow(armW, 1.2) * exp(-rho * 2.2) * step(rho, 1.3);
  }

  // ---- analytic bloom around the core and along the bright arms
  float coreB = ggCore / 5.0;
  float glow = (exp(-r * r / 0.005) * 0.3 + exp(-r * r / 0.05) * 0.16) * coreB;
  float pin = exp(-r * r / 0.0012) * coreB;
  col += (uC_hot * glow + vec3(0.95, 1.0, 0.9) * pin * 0.6 + uC_base * bloomArms * 0.18) * uP_bloom;

  // ---- solid sphere behind the gas: night fill and a fresnel rim
  float mask = orbOrganicMask(uv, R, uP_organic, uP_edgeSoft, uP_edgeFlow);
  vec3 mrd = normalize(vec3(uv, -GG_FOCAL));
  float closest = length(cross(vec3(0.0, 0.0, GG_CAM), mrd));
  float fres = smoothstep(ggEnv * 0.7, ggEnv, min(closest, ggEnv));
  col += uC_base * uP_rim * fres * fres * fres * mask;

  // ---- tendril glow past the rim
  float bl = orbBleed(uv, R, uP_reach, uP_edgeFlow) * uP_bleed * (0.7 + 0.6 * uOutput);
  col += uC_base * bl * 0.6 * (1.0 - mask);

  // ---- CRT
  vec2 fc = gl_FragCoord.xy;
  col *= orbsyScanline(fc, 3.0, uP_crt);
  col *= orbsyPhosphorMask(fc, uP_crt * 0.6);

  col = orbsyBloomTone(col, uP_exposure);
  col += uC_deep * uP_fill * mask;
  float fade = 1.0 - smoothstep(0.86, 0.99, r);
  col *= fade;
  float a = clamp(max(max(col.r, max(col.g, col.b)) * 1.3, uP_fill * mask), 0.0, 1.0) * fade;
  gl_FragColor = vec4(col, a);
}
`;

export const orbsy16Orb: OrbVariant = {
  key: "orbsy-16",
  label: "Green Galaxy",
  note: "a fluoro-green galaxy marched as gas and dust, white-hot core and star knots, a polar radar chart etched on the disc and a light CRT",
  frag: ORBSY16_FRAG,
  params: [
    { key: "spin", label: "Disc turn", min: 0, max: 3, step: 0.01, default: 0.06, integrate: true },
    { key: "churn", label: "Gas churn", min: 0, max: 5, step: 0.02, default: 0.25, integrate: true },
    { key: "beat", label: "Core beat", min: 0, max: 12, step: 0.05, default: 0.8, integrate: true },
    { key: "twinkle", label: "Twinkle rate", min: 0, max: 12, step: 0.05, default: 1.2, integrate: true },
    { key: "scan", label: "Ping rate", min: 0, max: 6, step: 0.01, default: 0.5, integrate: true },
    { key: "radius", label: "Radius", min: 0.3, max: 0.9, step: 0.01, default: 0.79 },
    { key: "tilt", label: "Tilt (0 edge-on)", min: 0, max: 1.5, step: 0.01, default: 0.9 },
    { key: "arms", label: "Arm count", min: 1, max: 6, step: 1, default: 2 },
    { key: "wind", label: "Arm winding", min: 0, max: 8, step: 0.05, default: 3.4 },
    { key: "ragged", label: "Arm fray", min: 0, max: 12, step: 0.05, default: 3 },
    { key: "armSharp", label: "Arm sharpness", min: 0.3, max: 8, step: 0.05, default: 2.2 },
    { key: "falloff", label: "Disc falloff", min: 0.3, max: 12, step: 0.05, default: 1.7 },
    { key: "thick", label: "Disc thickness", min: 0.01, max: 1, step: 0.005, default: 0.035 },
    { key: "bulge", label: "Core tightness", min: 2, max: 200, step: 1, default: 40 },
    { key: "core", label: "Core density", min: 0, max: 20, step: 0.1, default: 5 },
    { key: "turbScale", label: "Turbulence scale", min: 0.5, max: 30, step: 0.1, default: 9 },
    { key: "threshold", label: "Clumping", min: 0, max: 1, step: 0.01, default: 0.35 },
    { key: "density", label: "Gas density", min: 0.1, max: 40, step: 0.1, default: 14 },
    { key: "absorb", label: "Dust absorption", min: 0, max: 20, step: 0.1, default: 3.5 },
    { key: "gain", label: "Gas energy", min: 0.1, max: 4, step: 0.01, default: 1.8 },
    { key: "contrast", label: "Gas contrast", min: 0.05, max: 2, step: 0.01, default: 0.4 },
    { key: "stars", label: "Star knots", min: 0, max: 5, step: 0.05, default: 1.2 },
    { key: "starDensity", label: "Star density", min: 0, max: 1, step: 0.01, default: 0.35 },
    { key: "starScale", label: "Star scale", min: 5, max: 80, step: 1, default: 26 },
    { key: "pulse", label: "Beat depth", min: 0, max: 3, step: 0.01, default: 0.2 },
    { key: "breathe", label: "Disc breathing", min: 0, max: 2, step: 0.01, default: 0 },
    { key: "grid", label: "Polar chart", min: 0, max: 2, step: 0.01, default: 0.35 },
    { key: "ping", label: "Ping ring", min: 0, max: 2, step: 0.01, default: 0.4 },
    { key: "bloom", label: "Bloom", min: 0, max: 3, step: 0.01, default: 1 },
    { key: "crt", label: "CRT", min: 0, max: 0.6, step: 0.01, default: 0.2 },
    { key: "exposure", label: "Exposure", min: 0.2, max: 4, step: 0.01, default: 1.1 },
    { key: "fill", label: "Night fill", min: 0, max: 1, step: 0.01, default: 0.8 },
    { key: "rim", label: "Rim light", min: 0, max: 2, step: 0.01, default: 0.12 },
    { key: "spill", label: "Gas spill", min: 1, max: 1.8, step: 0.01, default: 1.3 },
    { key: "organic", label: "Rim wander", min: 0, max: 0.15, step: 0.005, default: 0.04 },
    { key: "edgeSoft", label: "Rim feather", min: 0, max: 0.2, step: 0.005, default: 0.035 },
    { key: "bleed", label: "Energy bleed", min: 0, max: 3, step: 0.01, default: 0.4 },
    { key: "reach", label: "Bleed reach", min: 0.02, max: 0.5, step: 0.005, default: 0.085 },
    { key: "edgeFlow", label: "Edge flow", min: 0, max: 3, step: 0.01, default: 0.3, integrate: true }
  ],
  colors: [
    { key: "deep", label: "Deep", default: "#010d04" },
    { key: "base", label: "Fluoro", default: "#39ff14" },
    { key: "hot", label: "Hot", default: "#d6ff5c" }
  ],
  /*
    As in SHDR-32 the tilt is the headline tell, then the clocks and the
    amplitudes. Arm count, winding, turbulence scale and star scale multiply
    a coordinate and are pinned across states.
  */
  statePresets: {
    // at rest: a three-quarter view, slow turn, the chart faint, rare pings
    idle: {
      tilt: 0.9, spin: 0.06, churn: 0.25, beat: 0.8, twinkle: 1.2, scan: 0.5, pulse: 0.2, breathe: 0,
      ragged: 3, armSharp: 2.2, thick: 0.035, threshold: 0.35, density: 14, core: 5, absorb: 3.5,
      gain: 1.8, contrast: 0.4, stars: 1.6, grid: 0.35, ping: 0.4, bloom: 1, crt: 0.2, exposure: 1.1, rim: 0.12,
      spill: 1.3, organic: 0.04, edgeSoft: 0.035, bleed: 0.4, reach: 0.085, edgeFlow: 0.3
    },
    // scanning: face-on whirlpool, frayed arms boiling, the chart bright with
    // fast pings, heavier scanlines, the core held down
    thinking: {
      tilt: 1.4, spin: 0.45, churn: 1.6, beat: 2.4, twinkle: 4.5, scan: 2.6, pulse: 0.25, breathe: 0,
      ragged: 8, armSharp: 1, thick: 0.07, threshold: 0.5, density: 18, core: 3, absorb: 6,
      gain: 1.7, contrast: 0.5, stars: 1.6, grid: 1, ping: 1.1, bloom: 0.8, crt: 0.32, exposure: 1.15, rim: 0.14,
      spill: 1.4, organic: 0.05, edgeSoft: 0.04, bleed: 0.5, reach: 0.09, edgeFlow: 0.9
    },
    // answering: the spiral lights up, the core flares on a hard beat and the
    // disc breathes, dust cleared, bloom up, spill furthest
    speaking: {
      tilt: 1.2, spin: 0.2, churn: 0.6, beat: 4.8, twinkle: 2.4, scan: 1.2, pulse: 1, breathe: 0.45,
      ragged: 2, armSharp: 1.8, thick: 0.04, threshold: 0.25, density: 18, core: 8, absorb: 1.6,
      gain: 1.55, contrast: 0.35, stars: 2, grid: 0.45, ping: 0.7, bloom: 1.4, crt: 0.18, exposure: 1.25, rim: 0.18,
      spill: 1.55, organic: 0.065, edgeSoft: 0.045, bleed: 0.8, reach: 0.11, edgeFlow: 1.1
    }
  },
  stateColors: {
    idle: { deep: "#010d04", base: "#39ff14", hot: "#d6ff5c" },
    thinking: { deep: "#01100a", base: "#2bff6e", hot: "#c8ffd8" },
    speaking: { deep: "#030f02", base: "#5aff1f", hot: "#eaff6a" }
  }
};

export type Orbsy16Props = Omit<ShaderOrbProps, "variant">;

export function Orbsy16({ size = 280, ...rest }: Orbsy16Props) {
  return <ShaderOrb variant={orbsy16Orb} size={size} {...rest} />;
}

export default Orbsy16;
