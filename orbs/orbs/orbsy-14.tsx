/*
 * Orbsy 14 — Mondrian. Original shader, MIT.
 * Not a "use client" module, so server components can read the variant as data.
 * The shader lives in a template literal: its comments must not contain backticks.
 */
import { ShaderOrb, type OrbVariant, type ShaderOrbProps } from "../core/orbkit-core";
import { ORBSY_GLSL } from "./orbsy-glsl";

/*
  A Mondrian painting in phosphor, wrapped on the ball. Each cube face is the
  root of a random binary split tree: every node picks an axis (the long side,
  or a coin toss when square) and a hashed split position, then the pixel
  follows the side it falls on. Each node runs its own stepped clock at a
  hashed rate, so nodes re-roll at different times: the rule slides to its
  next position, the subtree below re-splits and the cells flash. Cells take a
  palette from deep to fluoro green with a few white-hot ones, some filled
  with an ordered dither, separated by black rules that the hot cells bloom
  into. A light block glitch shears bands of the face now and then, and faint
  scanlines finish the CRT look.
*/
const ORBSY14_FRAG =
  ORBSY_GLSL +
  `
#define MD_DEPTH 7

void main() {
  vec2 uv = orbUV();
  float px = orbsyPx();
  float R = uP_radius * (1.0 + 0.03 * uP_react * uOutput);
  float r = length(uv);
  float t = uP_speed;
  float voice = uP_react * uOutput;

  float mask = orbOrganicMask(uv, R, uP_organic, uP_edgeSoft, uP_edgeFlow);
  vec4 s = orbsySphere(orbRimUV(uv, R), R, px);
  vec3 n = s.xyz;

  vec3 nb = n;
  nb.yz = orbsyRot(-0.38) * nb.yz;
  nb.xz = orbsyRot(uP_spin) * nb.xz;

  vec3 c = orbsyCubeUV(nb);
  float face = c.z;
  vec2 q = c.xy * 0.5 + 0.5;
  float fw = 0.5 * px / R * (1.0 + dot(c.xy, c.xy)) / max(s.z, 0.12);

  // Block glitch: a stepped clock picks a few horizontal bands of the face
  // and shears them sideways for one step.
  float gStep = floor(t * 5.0);
  float band = floor(q.y * 16.0);
  float gh = hash31(vec3(band, face * 3.1, gStep));
  float gOn = step(1.0 - 0.14 * uP_glitch * (1.0 + voice), gh);
  q.x = clamp(q.x + gOn * (hash31(vec3(band, gStep, 3.7)) - 0.5) * 0.16 * uP_glitch, 0.0, 1.0);

  // Descend the split tree.
  vec2 lo = vec2(0.0);
  vec2 hi = vec2(1.0);
  float id = hash31(vec3(face * 7.13, 1.7, 0.3));
  float flash = 0.0;
  for (int k = 0; k < MD_DEPTH; k++) {
    float fk = float(k);
    vec2 sz = hi - lo;
    float rate = mix(0.3, 1.6, hash31(vec3(id, 2.3, fk)));
    float clk = t * rate + id * 17.0;
    float ep = floor(clk);
    float ph = fract(clk);
    float stopP = k < 3 ? 0.0 : mix(0.45, 0.02, uP_detail) + 0.04 * fk;
    if (hash31(vec3(id, ep, 9.1)) < stopP || min(sz.x, sz.y) < 0.05) break;

    // A node that has just re-rolled flashes; about half of them do.
    flash = max(flash, exp(-ph * 12.0) * step(hash31(vec3(id, ep, 6.2)), 0.35));

    // The rule slides toward the next epoch's position at the end of a step.
    float sA = mix(0.28, 0.72, hash31(vec3(id, ep, 5.7)));
    float sB = mix(0.28, 0.72, hash31(vec3(id, ep + 1.0, 5.7)));
    float sp = mix(sA, sB, smoothstep(0.82, 1.0, ph));
    float coin = hash31(vec3(id, ep, 1.3));
    bool splitX = sz.x > sz.y * 1.35 || (sz.y <= sz.x * 1.35 && coin < 0.5);
    float side;
    if (splitX) {
      float cut = mix(lo.x, hi.x, sp);
      side = step(cut, q.x);
      if (side > 0.5) lo.x = cut; else hi.x = cut;
    } else {
      float cut = mix(lo.y, hi.y, sp);
      side = step(cut, q.y);
      if (side > 0.5) lo.y = cut; else hi.y = cut;
    }
    id = hash31(vec3(id * 13.7 + side * 3.1, fk + 1.0, ep));
  }

  // Leaf colour, re-rolled on its own stepped clock.
  float lRate = mix(0.2, 0.9, hash31(vec3(id, 8.8, 0.5)));
  float lClk = t * lRate + id * 23.0;
  float lEp = floor(lClk);
  float hc = hash31(vec3(id, lEp, 4.4));
  float hotF = uP_hot * (1.0 + 0.8 * voice);
  float e = 0.1;
  if (hc < 0.55) e = 0.26;
  if (hc < 0.34) e = 0.45;
  if (hc < 0.16 + hotF) e = 0.7;
  if (hc < hotF) e = 1.6;
  flash = max(flash, exp(-fract(lClk) * 12.0) * step(hc, 0.3));
  e += flash * uP_flash * (0.5 + 0.5 * voice);

  // Cell-local coordinates and the distance to the cell's rules.
  vec2 sz = hi - lo;
  vec2 f = (q - lo) / max(sz, vec2(1e-4));
  float dEdge = min(min(q.x - lo.x, hi.x - q.x), min(q.y - lo.y, hi.y - q.y));

  // Some cells are an ordered-dither gradient instead of a flat fill.
  if (hash31(vec3(id, 7.7, lEp)) < uP_dither) {
    float g = hash31(vec3(id, 3.3, lEp)) < 0.5 ? f.x : f.y;
    float lvl = e * mix(0.15, 1.2, g);
    float th = orbsyBayer8(gl_FragCoord.xy * 0.5);
    e = step(th, lvl / 1.3) * min(e + 0.2, 0.85) + 0.06;
  }

  vec3 cell = orbsyFluoro(e, uC_deep, uC_base, uC_hot);
  // A faint gradient inside each cell, brighter toward its upper edge.
  cell *= 0.82 + 0.3 * f.y;

  // Black rules, antialiased with the foreshortened footprint; the cell's own
  // light spills into its half of the rule so hot cells bloom across it.
  float lh = 0.5 * uP_line;
  float inCell = smoothstep(lh - fw, lh + fw, dEdge);
  float spill = exp(-max(lh - dEdge, 0.0) / (lh * 0.7 + 1e-4)) * uP_bloom * 0.45 * smoothstep(0.5, 1.4, e);
  float innerEdge = exp(-max(dEdge - lh, 0.0) / (0.006 + fw)) * 0.35 * smoothstep(0.4, 1.0, e);
  vec3 col = cell * (inCell * (1.0 + innerEdge) + (1.0 - inCell) * spill);

  // Sphere lighting (partial, the cells are emissive), limb glow, scanlines.
  vec3 L = normalize(vec3(-0.45, 0.55, 0.7));
  float lam = max(dot(n, L) * 0.7 + 0.3, 0.0);
  col *= mix((0.35 + 0.85 * lam) * mix(0.55, 1.0, s.z), 1.0, 0.3);
  float spec = pow(max(dot(reflect(-L, n), vec3(0.0, 0.0, 1.0)), 0.0), 24.0);
  col += vec3(0.7, 1.0, 0.75) * spec * 0.18;
  // Limb light only off hot cells: a constant limb term, once the bloom
  // lifts it, reads as a drawn ring around the ball.
  float limb = 1.0 - s.z;
  float hotRim = smoothstep(0.45, 1.0, e);
  col += uC_base * limb * limb * limb * 0.3 * hotRim;
  col *= orbsyScanline(gl_FragCoord.xy, 3.0, uP_scan);

  /*
    Past the rim: bleed tendrils in fluoro. orbBleed is at full strength right
    at the rim for every angle, so on its own it draws a solid ring; a patch
    field that varies in screen space breaks it into separate flares, hot
    cells at the rim feed them, and the uniform halo is gone.
  */
  float bl = orbBleed(uv, R, uP_reach, uP_edgeFlow) * uP_bleed * (0.7 + 0.6 * uOutput);
  float fl = 0.6 + 0.5 * noise3(vec3(uv * 5.0, uP_edgeFlow * 0.7));
  float rimPatch = smoothstep(0.38, 0.72, orbEdgeFbm(vec3(uv * 3.2, uP_edgeFlow * 0.45)));
  vec3 outer = uC_base * bl * fl * 0.6 * mix(0.12, 1.0, rimPatch) * (0.4 + 0.8 * hotRim) * (0.6 + 0.4 * uP_bloom);
  col = col * mask + outer * (1.0 - mask);

  col = orbsyBloomTone(col, uP_exposure);
  gl_FragColor = vec4(col, clamp(max(col.r, max(col.g, col.b)) * 1.2, 0.0, 1.0));
}
`;

export const orbsy14Orb: OrbVariant = {
  key: "orbsy-14",
  label: "Mondrian",
  note: "recursive Mondrian splits in phosphor green wrapped on the ball, re-splitting and flashing as each node re-rolls, with a slight block glitch",
  frag: ORBSY14_FRAG,
  params: [
    { key: "speed", label: "Re-split rate", min: 0, max: 3, step: 0.01, default: 0.2, integrate: true },
    { key: "spin", label: "Spin rate", min: 0, max: 2, step: 0.01, default: 0.07, integrate: true },
    { key: "radius", label: "Radius", min: 0.3, max: 1, step: 0.01, default: 0.79 },
    { key: "detail", label: "Detail", min: 0, max: 1, step: 0.01, default: 0.55 },
    { key: "line", label: "Rule width", min: 0, max: 0.08, step: 0.001, default: 0.03 },
    { key: "hot", label: "Hot cells", min: 0, max: 0.3, step: 0.005, default: 0.06 },
    { key: "dither", label: "Dithered cells", min: 0, max: 1, step: 0.01, default: 0.25 },
    { key: "flash", label: "Flash", min: 0, max: 2, step: 0.01, default: 0.7 },
    { key: "glitch", label: "Block glitch", min: 0, max: 2, step: 0.01, default: 0.4 },
    { key: "scan", label: "Scanlines", min: 0, max: 1, step: 0.01, default: 0.2 },
    { key: "bloom", label: "Bloom", min: 0, max: 2, step: 0.01, default: 0.9 },
    { key: "exposure", label: "Exposure", min: 0.3, max: 3, step: 0.01, default: 1.2 },
    { key: "react", label: "Voice react", min: 0, max: 2, step: 0.01, default: 1.0 },
    { key: "organic", label: "Rim wander", min: 0, max: 0.15, step: 0.005, default: 0.035 },
    { key: "edgeSoft", label: "Rim feather", min: 0, max: 0.2, step: 0.005, default: 0.03 },
    { key: "bleed", label: "Energy bleed", min: 0, max: 3, step: 0.01, default: 0.7 },
    { key: "reach", label: "Bleed reach", min: 0.02, max: 0.5, step: 0.005, default: 0.08 },
    { key: "edgeFlow", label: "Edge flow", min: 0, max: 3, step: 0.01, default: 0.3, integrate: true }
  ],
  colors: [
    { key: "deep", label: "Deep", default: "#010d04" },
    { key: "base", label: "Fluoro", default: "#39ff14" },
    { key: "hot", label: "Hot", default: "#d6ff5c" }
  ],
  statePresets: {
    // a calm composition that re-splits now and then
    idle: {
      speed: 0.12, spin: 0.05, detail: 0.45, hot: 0.05, dither: 0.22, flash: 0.5, glitch: 0.2,
      scan: 0.18, bloom: 0.8, exposure: 1.1, react: 0.8, organic: 0.03, bleed: 0.6, reach: 0.07, edgeFlow: 0.25
    },
    // busy: finer splits re-rolling fast, more glitch
    thinking: {
      speed: 0.7, spin: 0.16, detail: 0.85, hot: 0.07, dither: 0.35, flash: 0.9, glitch: 0.9,
      scan: 0.25, bloom: 0.9, exposure: 1.4, react: 0.8, organic: 0.045, bleed: 0.8, reach: 0.09, edgeFlow: 0.7
    },
    // brightest: bigger blocks, many white-hot cells flashing with the voice
    speaking: {
      speed: 0.4, spin: 0.08, detail: 0.5, hot: 0.1, dither: 0.2, flash: 1.3, glitch: 0.5,
      scan: 0.15, bloom: 1.3, exposure: 1.45, react: 1.4, organic: 0.065, bleed: 1.3, reach: 0.12, edgeFlow: 1.0
    }
  },
  stateColors: {
    idle: { deep: "#010d04", base: "#39ff14", hot: "#d6ff5c" },
    thinking: { deep: "#01100a", base: "#2bff6a", hot: "#c8ffb0" },
    speaking: { deep: "#030f02", base: "#5cff1f", hot: "#eaff7a" }
  }
};

export type Orbsy14Props = Omit<ShaderOrbProps, "variant">;

export function Orbsy14({ size = 280, ...rest }: Orbsy14Props) {
  return <ShaderOrb variant={orbsy14Orb} size={size} {...rest} />;
}

export default Orbsy14;
