/*
 * Orbsy 11 — Terminal. Original shader, MIT.
 * Not a "use client" module, so server components can read the variant as data.
 * The shader lives in a template literal: its comments must not contain backticks.
 */
import { ShaderOrb, type OrbVariant, type ShaderOrbProps } from "@/components/ui/orbkit-core";
import { ORBSY_GLSL } from "@/components/ui/orbsy-glsl";

/*
  A green-screen terminal wrapped around a ball, a spherical cousin of
  shdr-23. The glyph matrix is laid out in the sphere's own latitude and
  longitude: every latitude band is a text row, and the column count of each
  row shrinks with cos(latitude) so the characters stay square as they curve
  over the ball and roll with its spin. Each cell samples a streaming 3D fbm
  at its centre and draws the matching orbsyAscii density glyph.

  On top of the field, a hashed subset of rows carries bright streaks: a
  racing head of white-hot, flickering characters with a long fading tail
  that runs around the ball along its row (reference 2). The glyph-less
  glow of the same streaks is added as a soft phosphor bloom.

  The whole screen goes through a CRT: barrel curvature on uv, scanlines, an
  aperture-grille mask and a slow roll bar. Past the organic rim, energy
  escapes as sparse glyph rain: a screen-space glyph grid whose columns drip
  downward, thinned by the bleed falloff.
*/
const TERMINAL_FRAG =
  ORBSY_GLSL +
  `
// Streak intensity for a row: a head racing around the longitude with an
// exponential tail behind it. Returns (tail brightness, head closeness).
vec2 termStreak(float rowId, float u, float t) {
  float h = hash31(vec3(rowId, 7.1, 3.3));
  float on = step(1.0 - uP_streaks, hash31(vec3(rowId, 1.7, 9.2)));
  float spd = mix(0.35, 1.0, h) * (hash31(vec3(rowId, 4.4, 0.6)) > 0.5 ? 1.0 : -1.0);
  float head = fract(h * 13.7 + t * spd * 0.25);
  // distance behind the head, 0..1 around the ring, in the direction of travel
  float d = fract((head - u) * sign(spd));
  float tail = exp(-d * mix(1.8, 6.0, hash31(vec3(rowId, 2.2, 5.5))));
  return vec2(tail * on, exp(-d * 60.0) * on);
}

void main() {
  vec2 uv0 = orbUV();
  // CRT curvature: the whole picture, ball and rain, bulges like glass.
  vec2 uv = orbsyBarrel(uv0, uP_curve);
  float px = orbsyPx();
  float R = uP_radius * (1.0 + 0.03 * uOutput);
  float r = length(uv);
  float t = uP_speed;   // integrated: field stream + roll bar
  float st = uP_stream; // integrated: streak heads

  float mask = orbOrganicMask(uv, R, uP_organic, uP_edgeSoft, uP_edgeFlow);
  vec4 s = orbsySphere(orbRimUV(uv, R), R, px);
  vec3 n = s.xyz;

  // Spin enters as a longitude phase only.
  float lat = asin(clamp(n.y, -1.0, 1.0));
  float lon = atan(n.x, n.z) + uP_spin;

  // Latitude rows; per-row column count follows cos(lat) so cells stay square.
  float rows = uP_rows;
  float rv = (lat / PI + 0.5) * rows;
  float rowId = floor(rv);
  float latC = ((rowId + 0.5) / rows - 0.5) * PI;
  float cols = max(floor(rows * 2.0 * cos(latC) + 0.5), 3.0);
  float u = fract(lon / TAU);
  float cv = u * cols;
  float colId = floor(cv);
  vec2 p = vec2(fract(cv), fract(rv)) * 2.0 - 1.0;
  p.x *= 1.12; // a little gap between characters

  // Cell-centre direction, in the ball's own (spinning) frame.
  float lonC = (colId + 0.5) / cols * TAU;
  vec3 c = vec3(cos(latC) * sin(lonC), sin(latC), cos(latC) * cos(lonC));
  float field = fbm3(c * uP_scale + vec3(0.0, 0.0, t * 0.35));
  float cellH = hash31(vec3(colId, rowId, 11.0));

  // Head-on light so the glyph matrix reads as a ball.
  float lam = clamp(dot(n, normalize(vec3(-0.35, 0.45, 0.82))), 0.0, 1.0);
  float level = clamp((field - 0.42) * 2.4 + uP_density + 0.25 * uInput, 0.0, 1.0);
  level *= 0.45 + 0.55 * lam;

  vec2 sk = termStreak(rowId, u, st);
  float streak = sk.x * (0.75 + 0.5 * uOutput);
  // Characters in a streak flicker through the ramp, heads are solid blocks.
  float flick = hash31(vec3(colId, rowId, floor(st * 6.0 + cellH * 3.0)));
  float sLevel = max(level, mix(0.35, 1.0, flick) * smoothstep(0.05, 0.4, streak));
  sLevel = max(sLevel, step(0.5, sk.y) * 0.95);

  float glyph = orbsyAscii(sLevel, p);
  // Glyph edges fade out near the limb where cells get squashed.
  glyph *= smoothstep(0.02, 0.2, s.z);

  float e = glyph * (0.18 + 0.75 * level * uP_gain + streak * uP_streakGain + sk.y * 1.5);
  // Phosphor bloom: the glyph-less glow of the streak rows and the field.
  float bloom = streak * 0.28 * uP_bloom + level * 0.08 * uP_bloom;
  e += bloom * smoothstep(0.0, 0.25, s.z);
  // Dark glass body with a fluoro limb.
  float limb = 1.0 - s.z;
  e += 0.05 + limb * limb * limb * uP_rim;

  vec3 col = orbsyFluoro(e, uC_deep, uC_base, uC_hot) * mask;

  /*
    Glyph rain past the rim. A screen-space grid (so nothing smears radially);
    each column drips down on the edge clock and the bleed falloff sets how
    much of the trail survives, so it thins into sparse characters.
  */
  float cellPx = R * PI / rows;
  vec2 rg = uv / cellPx;
  vec2 rc = floor(rg);
  vec2 rp = fract(rg) * 2.0 - 1.0;
  float colH = hash31(vec3(rc.x, 3.0, 17.0));
  float drop = fract(rc.y * 0.07 * mix(0.6, 1.4, colH) + uP_edgeFlow * mix(0.4, 1.0, colH) + colH);
  float trail = drop * drop * drop;
  float vol = uP_bleed * (0.7 + 0.6 * uOutput);
  float bleed = orbBleed(uv, R, uP_reach, uP_edgeFlow) * vol;
  // The rain reaches further than the haze, and starts just off the rim.
  float rainBleed = orbBleed(uv, R, uP_reach * 2.5, uP_edgeFlow) * vol * smoothstep(0.0, 0.03, r - R);
  float rLevel = trail * rainBleed * 2.0;
  float rGlyph = orbsyAscii(clamp(0.15 + 0.55 * hash31(vec3(rc, floor(uP_edgeFlow * 4.0))) + 0.3 * rLevel, 0.0, 0.85), rp);
  float rain = rGlyph * min(rLevel, 1.0) * step(0.15, rLevel);
  float haze = bleed * 0.14;
  vec3 outside = orbsyFluoro(rain * 0.9 + haze, uC_deep, uC_base, uC_hot) * (rain + haze) * (1.0 - mask);
  col += outside;

  // CRT: scanlines, aperture grille, roll bar. Computed on the unbent screen.
  vec2 fc = gl_FragCoord.xy;
  float scanPitch = max(min(uRes.x, uRes.y) / 150.0, 2.0);
  col *= orbsyScanline(fc, scanPitch, uP_scan);
  col *= orbsyPhosphorMask(fc, uP_mask);
  col *= 1.0 + orbsyRollBar(uv0, t) * uP_roll;

  // Fade the bent frame corners to black so the tube never shows an edge.
  col *= 1.0 - smoothstep(0.9, 1.0, max(abs(uv.x), abs(uv.y)));

  col = orbsyBloomTone(col, uP_exposure * (0.9 + 0.35 * uOutput));
  float a = clamp(max(col.r, max(col.g, col.b)) * 1.2, 0.0, 1.0);
  gl_FragColor = vec4(col, a);
}
`;

export const orbsy11Orb: OrbVariant = {
  key: "orbsy-11",
  label: "Terminal",
  note: "a latitude-row ASCII matrix on the ball with racing glyph streaks, glyph rain and a full CRT",
  frag: TERMINAL_FRAG,
  params: [
    { key: "speed", label: "Field stream", min: 0, max: 3, step: 0.01, default: 0.3, integrate: true },
    { key: "stream", label: "Streak speed", min: 0, max: 4, step: 0.01, default: 0.5, integrate: true },
    { key: "spin", label: "Spin rate", min: 0, max: 2, step: 0.01, default: 0.12, integrate: true },
    { key: "radius", label: "Radius", min: 0.3, max: 1, step: 0.01, default: 0.78 },
    { key: "rows", label: "Glyph rows", min: 10, max: 60, step: 1, default: 26 },
    { key: "scale", label: "Field scale", min: 0.5, max: 6, step: 0.05, default: 2.2 },
    { key: "density", label: "Glyph density", min: -0.5, max: 1, step: 0.01, default: 0.05 },
    { key: "gain", label: "Glyph gain", min: 0, max: 3, step: 0.01, default: 1.0 },
    { key: "streaks", label: "Streak rows", min: 0, max: 1, step: 0.01, default: 0.25 },
    { key: "streakGain", label: "Streak burn", min: 0, max: 4, step: 0.01, default: 1.6 },
    { key: "bloom", label: "Phosphor bloom", min: 0, max: 3, step: 0.01, default: 1.0 },
    { key: "rim", label: "Rim glow", min: 0, max: 3, step: 0.01, default: 0.7 },
    { key: "curve", label: "CRT curvature", min: 0, max: 0.4, step: 0.005, default: 0.12 },
    { key: "scan", label: "Scanlines", min: 0, max: 1, step: 0.01, default: 0.35 },
    { key: "mask", label: "Phosphor mask", min: 0, max: 1, step: 0.01, default: 0.3 },
    { key: "roll", label: "Roll bar", min: 0, max: 1.5, step: 0.01, default: 0.25 },
    { key: "exposure", label: "Exposure", min: 0.3, max: 3, step: 0.01, default: 1.1 },
    { key: "organic", label: "Rim wander", min: 0, max: 0.15, step: 0.005, default: 0.04 },
    { key: "edgeSoft", label: "Rim feather", min: 0, max: 0.2, step: 0.005, default: 0.035 },
    { key: "bleed", label: "Energy bleed", min: 0, max: 3, step: 0.01, default: 0.9 },
    { key: "reach", label: "Bleed reach", min: 0.02, max: 0.5, step: 0.005, default: 0.12 },
    { key: "edgeFlow", label: "Edge flow", min: 0, max: 3, step: 0.01, default: 0.35, integrate: true }
  ],
  colors: [
    { key: "deep", label: "Deep", default: "#010d04" },
    { key: "base", label: "Fluoro", default: "#39ff14" },
    { key: "hot", label: "Hot", default: "#d6ff5c" }
  ],
  statePresets: {
    // a quiet terminal: sparse text, a few slow streaks, soft CRT
    idle: {
      speed: 0.2, stream: 0.35, spin: 0.08, rows: 26, density: 0.14, gain: 0.9,
      streaks: 0.22, streakGain: 1.4, bloom: 0.8, rim: 0.5, roll: 0.15, scan: 0.3,
      exposure: 1.0, organic: 0.035, bleed: 0.7, reach: 0.1, edgeFlow: 0.25
    },
    // scanning: finer rows, many fast streaks racing both ways, hard roll bar
    thinking: {
      speed: 0.7, stream: 1.6, spin: 0.3, rows: 34, density: 0.12, gain: 1.0,
      streaks: 0.55, streakGain: 1.8, bloom: 1.1, rim: 0.55, roll: 0.7, scan: 0.45,
      exposure: 1.1, organic: 0.045, bleed: 1.0, reach: 0.12, edgeFlow: 0.8
    },
    // transmitting: dense burning text, heavy bloom, glyph rain pours off
    speaking: {
      speed: 0.9, stream: 1.1, spin: 0.15, rows: 28, density: 0.3, gain: 1.4,
      streaks: 0.45, streakGain: 2.4, bloom: 1.8, rim: 0.8, roll: 0.35, scan: 0.35,
      exposure: 1.35, organic: 0.06, bleed: 1.6, reach: 0.16, edgeFlow: 1.1
    }
  },
  stateColors: {
    idle: { deep: "#010d04", base: "#39ff14", hot: "#d6ff5c" },
    thinking: { deep: "#010f07", base: "#2bff5a", hot: "#c4ffd0" },
    speaking: { deep: "#031002", base: "#5cff1f", hot: "#eaff80" }
  }
};

export type Orbsy11Props = Omit<ShaderOrbProps, "variant">;

export function Orbsy11({ size = 280, ...rest }: Orbsy11Props) {
  return <ShaderOrb variant={orbsy11Orb} size={size} {...rest} />;
}

export default Orbsy11;
