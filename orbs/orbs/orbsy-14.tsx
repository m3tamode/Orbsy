/*
 * Orbsy 14 — Circuit. Original shader, MIT.
 * Not a "use client" module, so server components can read the variant as data.
 * The shader lives in a template literal: its comments must not contain backticks.
 */
import { ShaderOrb, type OrbVariant, type ShaderOrbProps } from "../core/orbkit-core";
import { ORBSY_GLSL } from "./orbsy-glsl";

/*
  A circuit board wrapped on the ball, laid out on the cube faces so the grid
  never pinches at a pole.

  - LAYOUT. Each face is a grid of tiles that may split into 2x2 and again
    into 2x2 (three recursive scales). A hashed district value per coarse tile
    sets how likely its children are to split, so some districts are dense
    fine routing and others are coarse runs. A few coarse tiles are chips
    (a dithered package with a pin comb and a die mark) and a few are empty
    board with a silkscreen dot grid: the sparse regions.
  - TRACES. A routed tile is an octagonal Truchet tile: two traces, each
    joining two edge midpoints with a straight run, a 45 degree chamfer and
    another straight run. Some tiles are nodes instead: four stubs meet at a
    square pad. Where a neighbour sits at another scale (or is empty) the
    trace ends in a via ring set back from the edge.
  - PULSES. Every edge midpoint gets a flow direction from the parity of its
    lattice vertices (the usual Truchet two-colouring), so each trace has a
    consistent direction and a phase that runs on from tile to tile with a
    period of two tiles. A clock drives a sharp head with a decaying tail
    along it; a slow noise field gates which nets are live. Heads that reach
    a via or a node pad flash it white.
  - AA. Widths and distances live in face units, with a pixel footprint from
    the cube-map stretch and the foreshortening near the limb; where tiles
    shrink below a few pixels the lines fade to their mean coverage.
  - FINISH. A soft glow under live pulses, emissive shading, scanlines and a
    light phosphor mask, and bleed flares past the rim fed only where the rim
    content is hot.
*/
const ORBSY14_FRAG =
  ORBSY_GLSL +
  `
// Tile at q on a face: xy the tile origin, z its size, w its level
// (0..2 routed, 3 chip, -1 empty).
vec4 ccLeaf(vec2 q, float face) {
  q = clamp(q, 0.0, 0.99999);
  float N = floor(uP_grid + 0.5);
  float sz = 1.0 / N;
  vec2 c0 = floor(q * N);
  vec3 sd = vec3(c0, face * 13.1);
  float h = hash31(sd + vec3(0.0, 0.0, 0.37));
  if (h < uP_sparse) return vec4(c0 * sz, sz, -1.0);
  if (h < uP_sparse + uP_chips) return vec4(c0 * sz, sz, 3.0);
  float p = uP_detail * mix(0.3, 1.5, hash31(sd + vec3(0.0, 0.0, 0.71)));
  if (hash31(sd + vec3(0.0, 0.0, 0.93)) > p) return vec4(c0 * sz, sz, 0.0);
  sz *= 0.5;
  vec2 c1 = floor(q / sz);
  if (hash31(vec3(c1, face * 13.1 + 5.3)) > p * 0.75) return vec4(c1 * sz, sz, 1.0);
  sz *= 0.5;
  return vec4(floor(q / sz) * sz, sz, 2.0);
}

// 1.0 when the neighbour holding point p does not continue the trace.
float ccOpen(vec2 p, float face, float L) {
  if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0) return 0.0;
  float n = ccLeaf(p, face).w;
  return (n == L || n == 3.0) ? 0.0 : 1.0;
}

vec2 ccSeg(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return vec2(length(pa - ba * h), h);
}

// Chamfered trace from the left midpoint to the bottom midpoint of a unit
// tile: distance and arc-length fraction from the left end.
vec2 ccArc(vec2 p) {
  vec2 a = ccSeg(p, vec2(0.0, 0.5), vec2(0.25, 0.5));
  vec2 b = ccSeg(p, vec2(0.25, 0.5), vec2(0.5, 0.25));
  vec2 c = ccSeg(p, vec2(0.5, 0.25), vec2(0.5, 0.0));
  vec2 r = vec2(a.x, a.y * 0.25);
  if (b.x < r.x) r = vec2(b.x, 0.25 + b.y * 0.35355);
  if (c.x < r.x) r = vec2(c.x, 0.60355 + c.y * 0.25);
  return vec2(r.x, r.y / 0.85355);
}

// A pulse head at phase 0 with a decaying tail behind it. s runs 0..1 along
// the flow in a tile, k is the tile parity, so the phase continues across
// tiles with a period of two.
float ccPulse(float s, float k, float t) {
  float u = fract(t - 0.5 * (s + k));
  return exp(-u * uP_tail) * smoothstep(1.0, 0.93, u);
}

void main() {
  vec2 uv = orbUV();
  float px = orbsyPx();
  float voice = uP_react * uOutput;
  float R = uP_radius * (1.0 + 0.025 * voice);
  float r = length(uv);
  float t = uP_speed;
  vec2 fc = gl_FragCoord.xy;

  float mask = orbOrganicMask(uv, R, uP_organic, uP_edgeSoft, uP_edgeFlow);
  vec4 s = orbsySphere(orbRimUV(uv, R), R, px);
  vec3 n = s.xyz;

  vec3 nb = n;
  nb.yz = orbsyRot(-0.42) * nb.yz;
  nb.xz = orbsyRot(uP_spin) * nb.xz;
  nb.xy = orbsyRot(0.3) * nb.xy;

  vec3 c = orbsyCubeUV(nb);
  float face = c.z;
  vec2 q = c.xy * 0.5 + 0.5;
  // one pixel in face units: cube-map stretch and part of the limb squash
  float fw = 0.5 * px / R * (1.0 + dot(c.xy, c.xy)) / pow(max(s.z, 0.1), 0.7);

  // Live nets: a slow gate in the body frame, drifting on its own axis.
  float gate = smoothstep(0.42, 0.62, noise3(nb * 2.3 + vec3(0.0, uP_flow, 0.0)));
  gate = mix(uP_live, 1.0, gate) * (1.0 + 0.8 * voice);

  vec4 lf = ccLeaf(q, face);
  vec2 o = lf.xy;
  float sz = lf.z;
  float L = lf.w;
  vec2 f = (q - o) / sz;
  vec2 I = floor(o / sz + 0.5);
  float k = mod(I.x + I.y, 2.0);
  float lvl = clamp(L, 0.0, 2.0);
  float w = uP_trace * mix(1.0, 0.5, lvl * 0.5);
  w = max(w, fw * 0.6);
  // tiles shrinking under a few pixels fade to mean coverage
  float crowd = smoothstep(0.05, 0.14, fw / sz);
  float tp = t + L * 0.37;

  float e = uP_board;
  float cover = 0.0;
  float dq = 1.0;
  float pul = 0.0;
  float flash = 0.0;

  if (L < -0.5) {
    // empty board: a silkscreen dot grid
    vec2 g = fract(f * 6.0) - 0.5;
    float dd = length(g) * sz / 6.0;
    e += 0.12 * (1.0 - smoothstep(fw * 0.5, fw * 1.5, dd)) * (1.0 - crowd);
  } else if (L > 2.5) {
    // chip: package outline, dithered body, die mark, pin comb
    vec2 cf = abs(f - 0.5);
    float box = max(cf.x, cf.y);
    float along = cf.x > cf.y ? f.y : f.x;
    float side = cf.x > cf.y ? step(0.5, f.x) : 2.0 + step(0.5, f.y);
    float busy = hash31(vec3(I, face * 5.0 + floor(t * 2.0)));
    float act = 0.5 + 0.5 * sin(t * 6.2831 * 0.5 + hash31(vec3(I, face + 1.0)) * 6.28);
    float outline = 1.0 - smoothstep(w - fw, w + fw, abs(box - 0.27) * sz);
    float inside = 1.0 - smoothstep(-fw, fw, (box - 0.27) * sz);
    float dth = step(orbsyBayer8(floor(fc * 0.5)), 0.18 + 0.3 * act * uP_chipGlow);
    float die = 1.0 - smoothstep(w * 0.7 - fw, w * 0.7 + fw, abs(box - 0.11) * sz);
    float pinD = abs(fract(along * 8.0) - 0.5) / 8.0 * sz;
    float pinZone = step(0.27, box) * step(box, 0.4) * step(0.24, along) * step(along, 0.76);
    float pin = (1.0 - smoothstep(w * 0.8 - fw, w * 0.8 + fw, pinD)) * pinZone;
    float stub = (1.0 - smoothstep(w - fw, w + fw, abs(along - 0.5) * sz)) * step(0.27, box);
    float pinIdx = floor(along * 8.0);
    float blink = step(0.55, hash31(vec3(pinIdx + side * 11.0, I.x + I.y * 7.0 + face * 3.0, floor(t * 4.0 + side * 0.25))));
    e += inside * dth * (0.12 + 0.2 * act) * uP_chipGlow;
    e += outline * (0.55 + 0.3 * act);
    e += die * (0.3 + 1.4 * act * act * uP_chipGlow) * (1.0 + voice);
    e += pin * (0.25 + 1.3 * blink * gate);
    e += stub * (0.3 + 0.6 * act);
    cover = max(outline, max(pin, stub));
    e = mix(e, uP_board + 0.12, crowd);
  } else {
    // routed tile
    float oL = ccOpen(o + vec2(-0.25, 0.5) * sz, face, L);
    float oR = ccOpen(o + vec2(1.25, 0.5) * sz, face, L);
    float oB = ccOpen(o + vec2(0.5, -0.25) * sz, face, L);
    float oT = ccOpen(o + vec2(0.5, 1.25) * sz, face, L);

    float ht = hash31(vec3(I, face * 3.7 + L * 17.0 + 0.5));
    float d;
    float sT;
    float node = 0.0;
    if (ht < uP_nodes) {
      // node: four stubs into a square pad. Vertical edges feed in on odd
      // tiles, horizontal edges on even ones.
      vec2 a = ccSeg(f, vec2(0.0, 0.5), vec2(0.36, 0.5));
      vec2 b = ccSeg(f, vec2(1.0, 0.5), vec2(0.64, 0.5));
      vec2 cc = ccSeg(f, vec2(0.5, 0.0), vec2(0.5, 0.36));
      vec2 dd = ccSeg(f, vec2(0.5, 1.0), vec2(0.5, 0.64));
      float inV = k;
      float inH = 1.0 - k;
      vec2 m = vec2(a.x, a.y * 0.36);
      float inM = inV;
      if (b.x < m.x) { m = vec2(b.x, b.y * 0.36); inM = inV; }
      if (cc.x < m.x) { m = vec2(cc.x, cc.y * 0.36); inM = inH; }
      if (dd.x < m.x) { m = vec2(dd.x, dd.y * 0.36); inM = inH; }
      d = m.x;
      sT = inM > 0.5 ? m.y / 0.85355 : 1.0 - m.y / 0.85355;
      float arrive = ccPulse(0.36 / 0.85355, k, tp);
      float padBox = max(abs(f.x - 0.5), abs(f.y - 0.5));
      float ring = 1.0 - smoothstep(w - fw, w + fw, abs(padBox - 0.14) * sz);
      float fillP = (1.0 - smoothstep(-fw, fw, (padBox - 0.14) * sz));
      float dth = step(orbsyBayer8(floor(fc * 0.5)), 0.25 + 0.6 * arrive * gate);
      node = ring * (0.5 + 2.2 * arrive * gate) + fillP * dth * (0.15 + 1.2 * arrive * gate);
      flash = max(flash, arrive * gate * ring);
    } else {
      // octagonal Truchet: the trace from each vertical-edge end starts at
      // s = 0, and flows into the tile on odd tiles.
      vec2 p = f;
      if (hash31(vec3(I, face * 3.7 + L * 17.0 + 8.5)) < 0.5) p.x = 1.0 - p.x;
      vec2 A = ccArc(p);
      vec2 B = ccArc(1.0 - p);
      vec2 m = A.x < B.x ? A : B;
      d = m.x;
      sT = k > 0.5 ? m.y : 1.0 - m.y;
    }
    dq = d * sz;
    cover = 1.0 - smoothstep(w - fw, w + fw, dq);

    // Vias where the trace dead-ends: set back from the edge, the stub
    // beyond them cut away.
    float rv = 0.085 * sz;
    float viaE = 0.0;
    float cut = 1.0;
    for (int i = 0; i < 4; i++) {
      float op = i == 0 ? oL : (i == 1 ? oR : (i == 2 ? oB : oT));
      vec2 mid = i == 0 ? vec2(0.0, 0.5) : (i == 1 ? vec2(1.0, 0.5) : (i == 2 ? vec2(0.5, 0.0) : vec2(0.5, 1.0)));
      vec2 inw = i == 0 ? vec2(1.0, 0.0) : (i == 1 ? vec2(-1.0, 0.0) : (i == 2 ? vec2(0.0, 1.0) : vec2(0.0, -1.0)));
      if (op > 0.5) {
        vec2 vc = mid + inw * 0.17;
        float dv = length((f - vc) * sz);
        float ringV = 1.0 - smoothstep(w * 0.9 - fw, w * 0.9 + fw, abs(dv - rv));
        // s at this end: vertical-edge ends are s = 0 on odd tiles
        float sEnd = i < 2 ? (k > 0.5 ? 0.0 : 1.0) : (k > 0.5 ? 1.0 : 0.0);
        float pe = ccPulse(sEnd, k, tp) * gate;
        viaE = max(viaE, ringV * (0.45 + 2.4 * pe));
        flash = max(flash, ringV * pe);
        float along = dot(f - vc, -inw);
        float across = abs(dot(f - vc, vec2(inw.y, inw.x)));
        float hole = 1.0 - smoothstep(rv - w - fw, rv - w + fw, dv);
        float beyond = step(0.0, along) * step(across, 0.2);
        cut *= (1.0 - hole) * (1.0 - beyond);
      }
    }
    cover *= cut;

    pul = ccPulse(sT, k, tp) * gate;
    float copper = uP_copper * mix(1.0, 0.7, lvl * 0.5);
    e += cover * (copper + pul * uP_pulse);
    // glow around live pulses
    float gw = w * 1.6 + fw;
    e += exp(-max(dq - w, 0.0) / gw) * pul * uP_bloom * 0.7 * cut;
    e += viaE + node;
    e = mix(e, uP_board + copper * 0.35 + pul * 0.25, crowd);
  }

  // emissive shading
  float shade = mix(0.5, 1.0, s.z);
  e *= shade * (0.9 + 0.35 * voice);
  vec3 col = orbsyFluoro(e, uC_deep, uC_base, uC_hot);
  col *= orbsyScanline(fc, 3.0, uP_scan);
  col *= orbsyPhosphorMask(fc, uP_phosphor);

  /*
    Past the rim: bleed flares, broken up by a screen-space patch field and
    fed only where the rim content is hot, so no ring is drawn.
  */
  float hotRim = smoothstep(0.35, 1.1, e);
  float bl = orbBleed(uv, R, uP_reach, uP_edgeFlow) * uP_bleed * (0.7 + 0.6 * uOutput);
  float rimPatch = smoothstep(0.38, 0.72, orbEdgeFbm(vec3(uv * 3.2, uP_edgeFlow * 0.45)));
  float fl = 0.6 + 0.5 * noise3(vec3(uv * 6.0, uP_edgeFlow * 0.7));
  vec3 outer = uC_base * bl * fl * mix(0.12, 1.0, rimPatch) * (0.15 + 1.1 * hotRim);
  col = col * mask + outer * (1.0 - mask);

  col = orbsyBloomTone(col, uP_exposure);
  gl_FragColor = vec4(col, clamp(max(col.r, max(col.g, col.b)) * 1.2, 0.0, 1.0));
}
`;

export const orbsy14Orb: OrbVariant = {
  key: "orbsy-14",
  label: "Circuit",
  note: "a circuit board wrapped on the ball at three recursive scales, light pulses racing along the traces into vias and pads that flash white",
  frag: ORBSY14_FRAG,
  params: [
    { key: "speed", label: "Pulse rate", min: 0, max: 4, step: 0.01, default: 0.45, integrate: true },
    { key: "spin", label: "Spin rate", min: 0, max: 2, step: 0.01, default: 0.07, integrate: true },
    { key: "flow", label: "Net drift", min: 0, max: 2, step: 0.01, default: 0.12, integrate: true },
    { key: "radius", label: "Radius", min: 0.3, max: 1, step: 0.01, default: 0.79 },
    { key: "grid", label: "Tiles per face", min: 2, max: 6, step: 1, default: 3 },
    { key: "detail", label: "Subdivision", min: 0, max: 1, step: 0.01, default: 0.5 },
    { key: "sparse", label: "Empty board", min: 0, max: 0.4, step: 0.01, default: 0.1 },
    { key: "chips", label: "Chips", min: 0, max: 0.4, step: 0.01, default: 0.1 },
    { key: "nodes", label: "Node pads", min: 0, max: 0.5, step: 0.01, default: 0.15 },
    { key: "trace", label: "Trace width", min: 0.002, max: 0.03, step: 0.0005, default: 0.011 },
    { key: "copper", label: "Idle trace", min: 0, max: 0.6, step: 0.01, default: 0.24 },
    { key: "board", label: "Board", min: 0, max: 0.2, step: 0.005, default: 0.04 },
    { key: "pulse", label: "Pulse brightness", min: 0, max: 3, step: 0.01, default: 1.7 },
    { key: "tail", label: "Pulse tightness", min: 1, max: 20, step: 0.1, default: 6 },
    { key: "live", label: "Idle nets", min: 0, max: 1, step: 0.01, default: 0.2 },
    { key: "chipGlow", label: "Chip activity", min: 0, max: 2, step: 0.01, default: 0.8 },
    { key: "bloom", label: "Bloom", min: 0, max: 2, step: 0.01, default: 0.9 },
    { key: "scan", label: "Scanlines", min: 0, max: 1, step: 0.01, default: 0.2 },
    { key: "phosphor", label: "Phosphor mask", min: 0, max: 0.6, step: 0.01, default: 0.12 },
    { key: "exposure", label: "Exposure", min: 0.3, max: 3, step: 0.01, default: 1.2 },
    { key: "react", label: "Voice react", min: 0, max: 2, step: 0.01, default: 1.0 },
    { key: "organic", label: "Rim wander", min: 0, max: 0.15, step: 0.005, default: 0.035 },
    { key: "edgeSoft", label: "Rim feather", min: 0, max: 0.2, step: 0.005, default: 0.03 },
    { key: "bleed", label: "Energy bleed", min: 0, max: 3, step: 0.01, default: 0.8 },
    { key: "reach", label: "Bleed reach", min: 0.02, max: 0.5, step: 0.005, default: 0.09 },
    { key: "edgeFlow", label: "Edge flow", min: 0, max: 3, step: 0.01, default: 0.3, integrate: true }
  ],
  colors: [
    { key: "deep", label: "Deep", default: "#010f08" },
    { key: "base", label: "Fluoro", default: "#1bd26a" },
    { key: "hot", label: "Hot", default: "#8ff2b8" }
  ],
  statePresets: {
    // a quiet board: coarse routing, a few live nets ticking over
    idle: {
      speed: 0.35, spin: 0.05, flow: 0.08, detail: 0.45, pulse: 1.9, tail: 5, live: 0.4, chipGlow: 0.6,
      copper: 0.22, bloom: 0.8, scan: 0.18, exposure: 1.1, react: 0.8, organic: 0.03, bleed: 0.6,
      reach: 0.08, edgeFlow: 0.25
    },
    // computing: dense fine routing, every net live, fast tight pulses
    thinking: {
      speed: 1.6, spin: 0.14, flow: 0.4, detail: 0.82, pulse: 2.2, tail: 7, live: 0.85, chipGlow: 1.3,
      copper: 0.27, bloom: 1.0, scan: 0.26, exposure: 1.35, react: 0.8, organic: 0.045, bleed: 0.8,
      reach: 0.09, edgeFlow: 0.7
    },
    // brightest: long hot pulses and chips flaring with the voice
    speaking: {
      speed: 0.9, spin: 0.08, flow: 0.25, detail: 0.55, pulse: 2.3, tail: 3.5, live: 0.45, chipGlow: 1.6,
      copper: 0.3, bloom: 1.4, scan: 0.16, exposure: 1.4, react: 1.4, organic: 0.065, bleed: 1.0,
      reach: 0.12, edgeFlow: 1.0
    }
  },
  stateColors: {
    idle: { deep: "#010f08", base: "#1bd26a", hot: "#8ff2b8" },
    thinking: { deep: "#01100a", base: "#17cf8c", hot: "#a4f5dc" },
    speaking: { deep: "#02110b", base: "#2ee87c", hot: "#b6ffd2" }
  }
};

export type Orbsy14Props = Omit<ShaderOrbProps, "variant">;

export function Orbsy14({ size = 280, ...rest }: Orbsy14Props) {
  return <ShaderOrb variant={orbsy14Orb} size={size} {...rest} />;
}

export default Orbsy14;
