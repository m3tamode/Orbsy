/*
 * Orbsy 17 — Radar Topo. Original shader, MIT.
 * Not a "use client" module, so server components can read the variant as data.
 * The shader lives in a template literal: its comments must not contain backticks.
 */
import { ShaderOrb, type OrbVariant, type ShaderOrbProps } from "../core/orbkit-core";
import { ORBSY_GLSL } from "./orbsy-glsl";

/*
  A radar scope wrapped on a turning globe (a variation of orbsy-04 Contour).

  - TERRAIN. 3D fbm on the globe's own frame (tilted, then spun about its own
    polar axis). Isolines are drawn at a constant PIXEL width: the distance to
    the nearest contour is divided by the field's screen-space gradient, taken
    from two extra samples one pixel over. Every fifth line is an index line.
    Where the limb crowds the lines tighter than a pixel they fade to an even
    wash instead of aliasing into a solid band.
  - GRATICULE. Latitude and longitude every 30 degrees in the same globe
    frame, also at a constant pixel width via finite differences (longitude
    differences are wrapped across the atan branch cut).
  - SWEEP. A PPI beam turns about the screen centre. Behind it the phosphor
    trail decays exponentially with the angle swept since the beam passed,
    so contours flare white as the beam crosses and fade back to a dim ember.
    The sweep angle is rebuilt from sin/cos of its integrated clock, so the
    clock is only ever a phase.
  - BLIPS. Peaks above a threshold light as solid returns that flash on the
    beam and persist longer than the lines, with a soft halo for bloom.
  - HUD + CRT. A dashed range ring with bearing ticks just outside the rim
    (screen-space, so no rays), scanlines and an aperture-grille mask, and the
    fake bloom: a wide soft beam, a wash under the trail and a halo past the
    organic rim, all through orbsyBloomTone.
*/
const ORBSY17_FRAG =
  ORBSY_GLSL +
  `
// The point on the globe under screen point p, in the globe's own frame.
vec3 rtGlobe(vec2 p, float R) {
  float r = length(p);
  float rc = min(r, R * 0.999);
  vec3 n = vec3(p * (rc / max(r, 1e-5)), sqrt(R * R - rc * rc)) / R;
  n.yz = orbsyRot(uP_tilt) * n.yz;
  n.xz = orbsyRot(uP_spin) * n.xz;
  return n;
}

float rtHeight(vec3 m) {
  return fbm3(m * uP_scale + vec3(0.0, 0.0, uP_drift));
}

// Distance in pixels to the nearest grid line of spacing sp, for a value v
// whose one-pixel steps are dx and dy.
float rtGridPx(float v, float dx, float dy, float sp) {
  float f = abs(fract(v / sp + 0.5) - 0.5) * sp;
  return f / max(length(vec2(dx, dy)), 1e-5);
}

float rtWrap(float d) {
  return d - TAU * floor(d / TAU + 0.5);
}

void main() {
  vec2 uv = orbUV();
  float px = orbsyPx();
  float R = uP_radius * (1.0 + 0.03 * uOutput);
  float r = length(uv);

  float mask = orbOrganicMask(uv, R, uP_organic, uP_edgeSoft, uP_edgeFlow);
  vec2 suv = orbRimUV(uv, R);
  vec4 s = orbsySphere(suv, R, px);
  float lam = clamp(dot(s.xyz, normalize(vec3(-0.4, 0.5, 0.75))), 0.0, 1.0);
  float shade = mix(0.45, 1.0, lam);

  vec3 m = rtGlobe(suv, R);
  vec3 mx = rtGlobe(suv + vec2(px, 0.0), R);
  vec3 my = rtGlobe(suv + vec2(0.0, px), R);

  // ---- contours, constant pixel width
  float h = rtHeight(m);
  float hx = rtHeight(mx);
  float hy = rtHeight(my);
  float v = h * uP_lines;
  float dv = length(vec2(hx - h, hy - h)) * uP_lines;
  float f = abs(fract(v + 0.5) - 0.5);
  float dpx = f / max(dv, 1e-5);
  float major = 1.0 - step(0.5, mod(floor(v + 0.5), 5.0));
  float wdt = uP_width * mix(1.0, 1.9, major);
  float line = 1.0 - smoothstep(wdt * 0.5 - 0.5, wdt * 0.5 + 0.5, dpx);
  // sub-pixel spacing at the limb: fade to the mean coverage
  line = mix(line, clamp(wdt * dv, 0.0, 1.0) * 0.18, smoothstep(0.2, 0.5, dv));
  line *= mix(0.55, 1.0, major);

  // ---- graticule, constant pixel width
  float lat = asin(clamp(m.y, -1.0, 1.0));
  float lon = atan(m.z, m.x);
  float latX = asin(clamp(mx.y, -1.0, 1.0)) - lat;
  float latY = asin(clamp(my.y, -1.0, 1.0)) - lat;
  float lonX = rtWrap(atan(mx.z, mx.x) - lon);
  float lonY = rtWrap(atan(my.z, my.x) - lon);
  float gLat = rtGridPx(lat, latX, latY, PI / 6.0);
  float gLon = rtGridPx(lon + PI, lonX, lonY, PI / 6.0);
  float gw = 0.6;
  // one pixel step in latitude, reused to fade the crowded limb
  float gCrowd = 1.0 - smoothstep(0.03, 0.08, length(vec2(lonX, lonY)) * 0.5 + length(vec2(latX, latY)));
  float grat = max(1.0 - smoothstep(gw - 0.5, gw + 0.5, gLat),
                   (1.0 - smoothstep(gw - 0.5, gw + 0.5, gLon)) * (1.0 - smoothstep(1.2, 1.45, abs(lat))));
  // the equator a touch heavier
  grat = max(grat, (1.0 - smoothstep(0.9, 1.9, abs(lat) / max(length(vec2(latX, latY)), 1e-5))) * 0.9);
  grat *= mix(0.25, 1.0, gCrowd);

  // ---- the sweep: angle behind the beam, 0 at the beam, growing around
  float sa = atan(sin(uP_sweep), cos(uP_sweep));
  float ang = atan(uv.y, uv.x);
  float behind = mod(sa - ang, TAU);
  float lead = rtWrap(sa - ang);
  float arc = lead * max(r, 0.04);
  float trailLen = uP_trail * (1.0 + 0.5 * uOutput);
  float trail = exp(-behind / max(trailLen, 0.02));
  float beam = exp(-arc * arc / (4.0 * px * px));
  // the leading edge is hard, the wake soft
  float wake = lead > 0.0 ? exp(-arc / (px * 18.0)) : exp(arc / (px * 1.5));
  float soft = exp(-arc * arc / (0.0012 + 0.0015 * uOutput));
  float kick = uP_beam * (1.0 + 0.8 * uOutput + 0.4 * uInput);

  // ---- blips on the peaks: longer persistence than the lines
  float blipTrail = exp(-behind / max(trailLen * uP_persist, 0.02));
  // a solid core on the summit, an ordered-dither skirt around it (a raster
  // return rather than a painted blob) and a soft halo for bloom
  float lvl = smoothstep(uP_peak - 0.035, uP_peak + 0.02, h);
  float core = smoothstep(uP_peak + 0.015, uP_peak + 0.025, h);
  float dith = step(orbsyBayer8(gl_FragCoord.xy), lvl * lvl);
  float peak = max(core, dith * lvl);
  float peakHalo = smoothstep(uP_peak - 0.08, uP_peak + 0.02, h);
  float blip = peak * (0.2 + 2.6 * blipTrail + 2.0 * wake * kick);

  // ---- energy on the ball
  float lit = uP_ember + uP_glow * trail + kick * (wake * 0.9 + beam * 1.4);
  float e = line * lit * shade;
  e += grat * uP_grid * (0.35 + 0.9 * trail + wake * kick) * shade;
  e += blip * uP_blips;
  // bloom: the halo under blips, a wide soft beam and a wash under the trail
  e += peakHalo * uP_blips * 0.35 * (0.2 + blipTrail) * uP_bloom;
  e += (soft * kick * 0.35 + trail * 0.08 * uP_glow) * uP_bloom * shade;
  e += uP_fill * shade * (0.5 + trail);

  vec3 col = orbsyFluoro(e, uC_deep, uC_base, uC_hot) * mask;

  // ---- outside the rim: HUD ring, the beam's tip, halo and bleed
  float out1 = 1.0 - mask;
  float ringR = R * 1.075;
  float ringD = abs(r - ringR) / px;
  float dash = step(0.35, fract(ang / TAU * 72.0));
  float ring = (1.0 - smoothstep(0.4, 1.4, ringD)) * dash;
  float tick = step(0.9, fract(ang / TAU * 36.0 + 0.05)) * step(ringR, r) * (1.0 - smoothstep(ringR + 0.018, ringR + 0.02, r));
  float hud = (ring * 0.6 + tick) * uP_hud * (0.25 + trail + beam * 2.0);
  float tip = kick * (beam * 1.5 + soft * 0.3) * exp(-max(r - R, 0.0) / 0.06) * (1.0 - smoothstep(ringR, ringR + 0.03, r));
  float halo = exp(-max(r - R, 0.0) / 0.04) * uP_bloom * (0.05 + 0.25 * trail);
  float bl = orbBleed(uv, R, uP_reach, uP_edgeFlow) * uP_bleed * (0.3 + trail) * (0.8 + 0.6 * uOutput);
  float eo = (hud + tip + halo + bl) * out1;
  col += orbsyFluoro(eo, uC_deep, uC_base, uC_hot) * step(0.001, eo);

  // ---- CRT
  vec2 fc = gl_FragCoord.xy;
  col *= orbsyScanline(fc, 3.0, uP_scan);
  col *= orbsyPhosphorMask(fc, uP_phosphor);

  col = orbsyBloomTone(col, uP_exposure);
  col *= 1.0 - smoothstep(0.9, 1.0, r);
  float a = clamp(max(max(col.r, max(col.g, col.b)) * 1.2, mask * 0.55), 0.0, 1.0);
  gl_FragColor = vec4(col, a);
}
`;

export const orbsy17Orb: OrbVariant = {
  key: "orbsy-17",
  label: "Radar Topo",
  note: "topographic contours on a turning globe, lit by a radar sweep with phosphor trails and peak blips",
  frag: ORBSY17_FRAG,
  params: [
    { key: "sweep", label: "Sweep rate", min: 0, max: 8, step: 0.01, default: 1.1, integrate: true },
    { key: "spin", label: "Globe spin", min: 0, max: 2, step: 0.01, default: 0.06, integrate: true },
    { key: "drift", label: "Terrain drift", min: 0, max: 3, step: 0.01, default: 0.06, integrate: true },
    { key: "tilt", label: "Axial tilt", min: -1.5, max: 1.5, step: 0.01, default: 0.45 },
    { key: "radius", label: "Radius", min: 0.3, max: 1, step: 0.01, default: 0.78 },
    { key: "scale", label: "Terrain scale", min: 0.5, max: 6, step: 0.05, default: 1.7 },
    { key: "lines", label: "Contour count", min: 3, max: 40, step: 0.5, default: 13 },
    { key: "width", label: "Line width (px)", min: 0.5, max: 4, step: 0.05, default: 1.3 },
    { key: "trail", label: "Phosphor trail", min: 0.1, max: 6, step: 0.05, default: 1.3 },
    { key: "persist", label: "Blip persistence", min: 1, max: 4, step: 0.05, default: 2.2 },
    { key: "beam", label: "Beam", min: 0, max: 3, step: 0.01, default: 1.2 },
    { key: "glow", label: "Trail glow", min: 0, max: 3, step: 0.01, default: 1.3 },
    { key: "ember", label: "Line ember", min: 0, max: 1, step: 0.01, default: 0.14 },
    { key: "grid", label: "Graticule", min: 0, max: 1.5, step: 0.01, default: 0.35 },
    { key: "peak", label: "Blip height", min: 0.5, max: 0.95, step: 0.005, default: 0.705 },
    { key: "blips", label: "Blip brightness", min: 0, max: 3, step: 0.01, default: 1 },
    { key: "hud", label: "Range ring", min: 0, max: 2, step: 0.01, default: 0.6 },
    { key: "fill", label: "Body fill", min: 0, max: 0.3, step: 0.005, default: 0.04 },
    { key: "bloom", label: "Bloom", min: 0, max: 3, step: 0.01, default: 1 },
    { key: "scan", label: "Scanlines", min: 0, max: 0.8, step: 0.01, default: 0.25 },
    { key: "phosphor", label: "Phosphor mask", min: 0, max: 0.6, step: 0.01, default: 0.15 },
    { key: "exposure", label: "Exposure", min: 0.3, max: 3, step: 0.01, default: 1.1 },
    { key: "organic", label: "Rim wander", min: 0, max: 0.15, step: 0.005, default: 0.035 },
    { key: "edgeSoft", label: "Rim feather", min: 0, max: 0.2, step: 0.005, default: 0.03 },
    { key: "bleed", label: "Energy bleed", min: 0, max: 3, step: 0.01, default: 0.6 },
    { key: "reach", label: "Bleed reach", min: 0.02, max: 0.5, step: 0.005, default: 0.08 },
    { key: "edgeFlow", label: "Edge flow", min: 0, max: 3, step: 0.01, default: 0.3, integrate: true }
  ],
  colors: [
    { key: "deep", label: "Deep", default: "#010d04" },
    { key: "base", label: "Fluoro", default: "#39ff14" },
    { key: "hot", label: "Hot", default: "#d6ff5c" }
  ],
  /*
    Scale, line count and the sweep geometry are the tells; lines and scale
    multiply a coordinate but glide smoothly (the field just re-contours).
  */
  statePresets: {
    // a slow patrol: long persistence, lazy globe
    idle: {
      sweep: 1.1, spin: 0.06, drift: 0.06, tilt: 0.45, scale: 1.7, lines: 13, width: 1.3,
      trail: 1.3, persist: 2.2, beam: 1.2, glow: 1.3, ember: 0.14, grid: 0.35, peak: 0.705,
      blips: 1, hud: 0.6, fill: 0.04, bloom: 1, scan: 0.25, phosphor: 0.15, exposure: 1.1,
      organic: 0.035, edgeSoft: 0.03, bleed: 0.6, reach: 0.08, edgeFlow: 0.3
    },
    // scanning hard: fast beam with a short trail, dense survey lines, the
    // graticule up, more returns, terrain shifting underneath
    thinking: {
      sweep: 4.2, spin: 0.22, drift: 0.3, tilt: 0.2, scale: 2.3, lines: 20, width: 1.05,
      trail: 0.7, persist: 3, beam: 1.5, glow: 1.2, ember: 0.12, grid: 0.8, peak: 0.69,
      blips: 1.3, hud: 1.1, fill: 0.03, bloom: 1.1, scan: 0.35, phosphor: 0.2, exposure: 1.15,
      organic: 0.045, edgeSoft: 0.035, bleed: 0.8, reach: 0.09, edgeFlow: 0.8
    },
    // transmitting: brightest, heavy lines, a long hot trail, bloom up
    speaking: {
      sweep: 2.4, spin: 0.1, drift: 0.5, tilt: 0.55, scale: 1.9, lines: 14, width: 1.8,
      trail: 2.2, persist: 1.6, beam: 2.2, glow: 2.1, ember: 0.35, grid: 0.45, peak: 0.695,
      blips: 1.7, hud: 1.0, fill: 0.07, bloom: 1.8, scan: 0.22, phosphor: 0.12, exposure: 1.35,
      organic: 0.06, edgeSoft: 0.04, bleed: 1.3, reach: 0.12, edgeFlow: 1.1
    }
  },
  stateColors: {
    idle: { deep: "#010d04", base: "#39ff14", hot: "#d6ff5c" },
    thinking: { deep: "#01100a", base: "#2bff6e", hot: "#c8ffd8" },
    speaking: { deep: "#030f02", base: "#5aff1f", hot: "#eaff6a" }
  }
};

export type Orbsy17Props = Omit<ShaderOrbProps, "variant">;

export function Orbsy17({ size = 280, ...rest }: Orbsy17Props) {
  return <ShaderOrb variant={orbsy17Orb} size={size} {...rest} />;
}

export default Orbsy17;
