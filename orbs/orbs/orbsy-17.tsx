/*
 * Orbsy 17 — Slice Scan. Original shader, MIT.
 * Not a "use client" module, so server components can read the variant as data.
 * The shader lives in a template literal: its comments must not contain backticks.
 */
import { ShaderOrb, type OrbVariant, type ShaderOrbProps } from "../core/orbkit-core";
import { ORBSY_GLSL } from "./orbsy-glsl";

/*
  A CT scanner in phosphor. The ball holds a 3D density field and one or more
  scan planes sweep through it, each showing its cross-section.

  - PLANES. Each plane has a normal that wobbles on a tilt clock (kept facing
    the viewer enough that the slice never goes edge-on) and an offset that
    swings through the ball on a sweep clock; both clocks only enter through
    sin and cos. The view is orthographic, so the plane point under a pixel
    is solved directly, and the ball's cut (where the plane meets the shell)
    is an ellipse drawn at a constant pixel width from the gradient of
    |p|^2 - 1 along the plane.
  - VOXELS. The plane carries a square grid in its own coordinates. Each
    cell samples the density at its centre in 3D (two octaves of value
    noise, a denser shell near the surface and a faint core), quantised to a
    few levels. Cells are crisp squares, antialiased with the grid's exact
    screen-space footprint; the densest ones get a white-hot core and a thin
    tail of cells below the cut-off survive as an ordered dither, so blobs
    fall off in a raster rather than a gradient.
  - PERSISTENCE. Behind the primary plane a few ghost slices are drawn where
    it was a moment ago, as hollow wireframe voxels and their cut ellipse,
    each dimmer than the last: the phosphor still glowing from earlier scans.
  - SHELL + CRT. The ball's outline is a faint glass glint on one side only,
    brightening where a slice meets it. Scanlines and a phosphor mask finish
    it, and bleed flares past the rim are fed only where the rim is hot.
*/
const ORBSY17_FRAG =
  ORBSY_GLSL +
  `
float ssDensity(vec3 P) {
  vec3 q = P * uP_scale + vec3(0.0, uP_drift, 0.0);
  float v = noise3(q) * 0.62 + noise3(q * 2.3 + vec3(7.1, 3.3, 1.9)) * 0.38;
  float th = uP_thresh - 0.1 * uP_react * uOutput;
  float lp = length(P);
  float blob = smoothstep(th, th + 0.28, v) * (1.0 - smoothstep(0.62, 0.84, lp));
  float sd = (lp - 0.88) / 0.055;
  float shell = exp(-sd * sd) * (0.45 + 0.55 * noise3(P * 5.0 + vec3(3.0, 1.0, 0.0))) * uP_shell;
  float core = exp(-lp * lp * 5.0) * 0.25;
  return clamp(blob + shell + core, 0.0, 1.0);
}

vec3 ssNormal(float a, float k) {
  return normalize(vec3(0.85 * sin(a + k), 0.65 * sin(a * 0.71 + 1.3 + k * 1.7), 1.0));
}

// One slice. xy: point in unit-ball screen coords, pu: one pixel in the same
// units, nP / d0 the plane, h the voxel size, ghost 0 (live) or 1 (wireframe).
// Returns energy.
float ssSlice(vec2 xy, float pu, vec3 nP, float d0, float h, float ghost) {
  float z = (d0 - nP.x * xy.x - nP.y * xy.y) / nP.z;
  vec3 p = vec3(xy, z);
  float rr = dot(p, p);
  float dzx = -nP.x / nP.z;
  float dzy = -nP.y / nP.z;
  vec2 gF = 2.0 * vec2(xy.x + z * dzx, xy.y + z * dzy);
  float gl = max(length(gF), 1e-4);
  // pixels from the cut ellipse, and antialiased inside coverage
  float dEl = abs(rr - 1.0) / gl / pu;
  float inside = clamp((1.0 - rr) / (gl * pu) + 0.5, 0.0, 1.0);
  float ring = 1.0 - smoothstep(0.4, 1.4, dEl);
  float ringGlow = exp(-dEl / 5.0);
  if (inside <= 0.0) return (ring * 1.1 + ringGlow * 0.25) * mix(1.0, 0.4, ghost);

  vec3 eU = normalize(cross(vec3(0.0, 1.0, 0.0), nP));
  vec3 eV = cross(nP, eU);
  vec2 w = vec2(dot(p, eU), dot(p, eV)) / h;
  // grid cells per pixel along each grid axis
  vec2 wx = vec2(eU.x + eU.z * dzx, eV.x + eV.z * dzx) / h * pu;
  vec2 wy = vec2(eU.y + eU.z * dzy, eV.y + eV.z * dzy) / h * pu;
  vec2 fwc = abs(wx) + abs(wy);
  vec2 cell = floor(w);
  vec2 f = abs(fract(w) - 0.5);
  vec3 P = nP * d0 + eU * (cell.x + 0.5) * h + eV * (cell.y + 0.5) * h;
  float dens = ssDensity(P) * step(length(P), 0.985);
  float lv = floor(dens * 5.0 + 0.5) / 5.0;
  float on = step(orbsyBayer8(cell), dens * 2.6);
  float g = 0.4;
  vec2 sq2 = (1.0 - smoothstep(g - fwc, g + fwc, f));
  float sq = sq2.x * sq2.y;
  vec2 cr2 = (1.0 - smoothstep(0.16 - fwc, 0.16 + fwc, f));
  float coreSq = cr2.x * cr2.y * smoothstep(0.7, 0.9, lv);
  float lit = max(lv, 0.22);
  float e;
  if (ghost < 0.5) {
    e = sq * on * (0.12 + 1.35 * lit * lit) + coreSq * 1.3 * on;
    // subpixel cells fade to their mean
    float crowd = smoothstep(0.22, 0.5, max(fwc.x, fwc.y));
    e = mix(e, on * (0.12 + 1.35 * lit * lit) * 0.64, crowd);
    e += 0.035 * uP_glassFill;
  } else {
    vec2 in2 = (1.0 - smoothstep(g - 0.09 - fwc, g - 0.09 + fwc, f));
    float hollow = sq - in2.x * in2.y;
    e = hollow * step(0.4, lv) * lv * 0.9;
    e *= 1.0 - smoothstep(0.3, 0.55, max(fwc.x, fwc.y));
  }
  e *= inside;
  return e + (ring * 1.1 + ringGlow * 0.25) * mix(1.0, 0.4, ghost);
}

void main() {
  vec2 uv = orbUV();
  float px = orbsyPx();
  float voice = uP_react * uOutput;
  float R = uP_radius * (1.0 + 0.025 * voice);
  float r = length(uv);
  vec2 fc = gl_FragCoord.xy;

  float mask = orbOrganicMask(uv, R, uP_organic, uP_edgeSoft, uP_edgeFlow);
  vec2 suv = orbRimUV(uv, R);
  vec4 s = orbsySphere(suv, R, px);
  vec2 xy = suv / R;
  float pu = px / R;
  float h = 2.0 / uP_voxels;

  float e = 0.0;
  float bright = uP_bright * (1.0 + 0.9 * voice);
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float wgt = clamp(uP_slices - fi, 0.0, 1.0);
    if (wgt > 0.0) {
      vec3 nP = ssNormal(uP_tilt, fi * 2.1);
      float d0 = 0.72 * sin(uP_sweep + fi * 2.094);
      e += wgt * ssSlice(xy, pu, nP, d0, h, 0.0) * bright;
    }
  }
  // phosphor persistence: where the primary plane was a moment ago
  for (int j = 1; j <= 3; j++) {
    float fj = float(j);
    vec3 nG = ssNormal(uP_tilt - fj * uP_gap * 0.3, 0.0);
    float dG = 0.72 * sin(uP_sweep - fj * uP_gap);
    e += ssSlice(xy, pu, nG, dG, h, 1.0) * uP_persist * exp(-fj * 0.75);
  }

  // glass shell: a glint on the upper left only, never a full ring
  float limb = 1.0 - s.z;
  float glint = smoothstep(0.3, 1.0, dot(normalize(suv + 1e-5), normalize(vec2(-0.6, 0.8))));
  e += limb * limb * limb * limb * uP_glass * (0.12 + glint) * s.w;

  vec3 col = orbsyFluoro(e, uC_deep, uC_base, uC_hot);
  col *= orbsyScanline(fc, 3.0, uP_scan);
  col *= orbsyPhosphorMask(fc, uP_phosphor);
  col += uC_base * orbsyRollBar(uv, uP_edgeFlow * 3.0) * 0.06 * uP_scan * mask;

  /*
    Past the rim: bleed flares broken up by a screen-space patch field and fed
    only by hot content at the rim (a slice's cut or bright voxels there).
  */
  float hotRim = smoothstep(0.3, 1.1, e);
  float bl = orbBleed(uv, R, uP_reach, uP_edgeFlow) * uP_bleed * (0.7 + 0.6 * uOutput);
  float rimPatch = smoothstep(0.38, 0.72, orbEdgeFbm(vec3(uv * 3.2, uP_edgeFlow * 0.45)));
  float fl = 0.6 + 0.5 * noise3(vec3(uv * 6.0, uP_edgeFlow * 0.7));
  vec3 outer = uC_base * bl * fl * mix(0.12, 1.0, rimPatch) * (0.1 + 1.2 * hotRim);
  col = col * mask + outer * (1.0 - mask);

  col = orbsyBloomTone(col, uP_exposure);
  gl_FragColor = vec4(col, clamp(max(col.r, max(col.g, col.b)) * 1.2, 0.0, 1.0));
}
`;

export const orbsy17Orb: OrbVariant = {
  key: "orbsy-17",
  label: "Slice Scan",
  note: "scan planes sweep through a voxel density field inside the ball, each cross-section a grid of glowing phosphor voxels with ghost slices decaying behind",
  frag: ORBSY17_FRAG,
  params: [
    { key: "sweep", label: "Sweep rate", min: 0, max: 6, step: 0.01, default: 0.6, integrate: true },
    { key: "tilt", label: "Tilt drift", min: 0, max: 2, step: 0.01, default: 0.15, integrate: true },
    { key: "drift", label: "Field drift", min: 0, max: 2, step: 0.01, default: 0.08, integrate: true },
    { key: "radius", label: "Radius", min: 0.3, max: 1, step: 0.01, default: 0.79 },
    { key: "slices", label: "Slices", min: 1, max: 3, step: 0.01, default: 1 },
    { key: "voxels", label: "Voxels across", min: 8, max: 40, step: 1, default: 20 },
    { key: "scale", label: "Field scale", min: 0.5, max: 5, step: 0.05, default: 2.2 },
    { key: "thresh", label: "Density cut", min: 0.2, max: 0.8, step: 0.01, default: 0.47 },
    { key: "shell", label: "Shell density", min: 0, max: 1, step: 0.01, default: 0.55 },
    { key: "bright", label: "Brightness", min: 0.2, max: 3, step: 0.01, default: 1.1 },
    { key: "gap", label: "Ghost spacing", min: 0.05, max: 1.5, step: 0.01, default: 0.35 },
    { key: "persist", label: "Persistence", min: 0, max: 2, step: 0.01, default: 0.7 },
    { key: "glass", label: "Glass shell", min: 0, max: 2, step: 0.01, default: 0.6 },
    { key: "glassFill", label: "Slice fill", min: 0, max: 3, step: 0.01, default: 1 },
    { key: "scan", label: "Scanlines", min: 0, max: 1, step: 0.01, default: 0.3 },
    { key: "phosphor", label: "Phosphor mask", min: 0, max: 0.6, step: 0.01, default: 0.2 },
    { key: "exposure", label: "Exposure", min: 0.3, max: 3, step: 0.01, default: 1.15 },
    { key: "react", label: "Voice react", min: 0, max: 2, step: 0.01, default: 1.0 },
    { key: "organic", label: "Rim wander", min: 0, max: 0.15, step: 0.005, default: 0.035 },
    { key: "edgeSoft", label: "Rim feather", min: 0, max: 0.2, step: 0.005, default: 0.03 },
    { key: "bleed", label: "Energy bleed", min: 0, max: 3, step: 0.01, default: 0.7 },
    { key: "reach", label: "Bleed reach", min: 0.02, max: 0.5, step: 0.005, default: 0.08 },
    { key: "edgeFlow", label: "Edge flow", min: 0, max: 3, step: 0.01, default: 0.3, integrate: true }
  ],
  colors: [
    { key: "deep", label: "Deep", default: "#010f08" },
    { key: "base", label: "Fluoro", default: "#1bd26a" },
    { key: "hot", label: "Hot", default: "#8ff2b8" }
  ],
  statePresets: {
    // one slow plane drifting through, long ghosts behind it
    idle: {
      sweep: 0.5, tilt: 0.12, drift: 0.06, slices: 1, voxels: 20, thresh: 0.48, bright: 1.05,
      gap: 0.4, persist: 0.95, glass: 1.0, scan: 0.28, phosphor: 0.18, exposure: 1.1, react: 0.8,
      organic: 0.03, bleed: 0.6, reach: 0.08, edgeFlow: 0.25
    },
    // scanning: three planes racing through a finer grid, short ghosts
    thinking: {
      sweep: 2.6, tilt: 0.5, drift: 0.2, slices: 3, voxels: 28, thresh: 0.5, bright: 1.0,
      gap: 0.22, persist: 0.6, glass: 1.1, scan: 0.34, phosphor: 0.22, exposure: 1.15, react: 0.8,
      organic: 0.045, bleed: 0.8, reach: 0.09, edgeFlow: 0.7
    },
    // brightest: two planes of big voxels swelling with the voice
    speaking: {
      sweep: 1.2, tilt: 0.25, drift: 0.3, slices: 2, voxels: 16, thresh: 0.43, bright: 1.3,
      gap: 0.3, persist: 1.0, glass: 1.3, scan: 0.24, phosphor: 0.16, exposure: 1.35, react: 1.4,
      organic: 0.065, bleed: 0.85, reach: 0.12, edgeFlow: 1.0
    }
  },
  stateColors: {
    idle: { deep: "#010f08", base: "#1bd26a", hot: "#8ff2b8" },
    thinking: { deep: "#01100a", base: "#17cf8c", hot: "#a4f5dc" },
    speaking: { deep: "#02110b", base: "#2ee87c", hot: "#b6ffd2" }
  }
};

export type Orbsy17Props = Omit<ShaderOrbProps, "variant">;

export function Orbsy17({ size = 280, ...rest }: Orbsy17Props) {
  return <ShaderOrb variant={orbsy17Orb} size={size} {...rest} />;
}

export default Orbsy17;
