/*
 * Orbsy 20 — Phosphor Green. MIT. Derived from Orbkit's SHDR-23 (Phosphor,
 * original Orbkit work, MIT), recoloured and relit for the fluoro-green set.
 * Not a "use client" module, so server components can read the variant as data.
 * The shader lives in a template literal: its comments must not contain backticks.
 */
import { ShaderOrb, type OrbVariant, type ShaderOrbProps } from "@/components/ui/orbkit-core";
import { ORBSY_GLSL } from "@/components/ui/orbsy-glsl";

/*
  SHDR-23's ASCII glyph matrix, burning fluoro green on a CRT.

  The structure is SHDR-23's: a resolution-relative grid of glyph cells, each
  drawing a woven character of stacked dashes whose lit row count quantizes a
  drifting fbm field seen through the stereographic wrap of a rotating dome,
  with blocky 2x2 super-cell dropouts carving black holes out of the matrix and
  an organic silhouette cut on the cell grid. Three motions on their own
  integrated clocks: drift (idle), scroll (thinking), pulse (speaking).

  What the green set adds:
  - Glyphs are lit through the fluoro energy ramp (deep, fluoro, hot, white),
    so dense characters run hot and the densest burn toward white.
  - Flares: on a stepped clock a scattering of dense cells light every row at
    once and swell to white, with a small halo filling their cell.
  - Bloom: a per-fragment, low-octave copy of the same field (dropouts
    included, softened) glows under the matrix where it is bright, so bright
    regions read as light rather than as characters on black.
  - A light CRT: scanlines, an aperture-grille phosphor mask and a roll bar.
  - The fresnel rim and the energy leak are gated by the local brightness and
    by a screen-space patch field, so nothing makes a uniform ring.
  The ball keeps SHDR-23's dark body, so alpha is coverage inside the mask and
  the brightest channel outside it (premultiplied either way).
*/
const ORBSY20_FRAG =
  ORBSY_GLSL +
  `
// Three-octave fbm: the low-frequency body of fbm(), for the bloom copy.
float phgFbm3(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 3; i++) {
    v += a * noise(p);
    p = p * 2.03 + vec2(11.7, 7.3);
    a *= 0.5;
  }
  return v;
}

// Rotating dome, stereographic projection (SHDR-23's wrap).
vec2 phgWrap(vec2 uv, float cr, float sr) {
  float z = sqrt(max(1.0 - dot(uv, uv), 0.0));
  vec3 sp = vec3(uv.x * cr - z * sr, uv.y, uv.x * sr + z * cr);
  return sp.xy / (abs(sp.z) + 1.2) * uP_scale * 3.0;
}

void main() {
  float densBias = uP_density + 0.2 * uInput;
  float gainNow = uP_gain * (0.85 + 0.5 * uOutput);
  float burnNow = uP_burn * (0.9 + 0.3 * uOutput);

  // resolution-relative glyph grid
  float cellPx = max(min(uRes.x, uRes.y) / max(uP_cells, 8.0), 4.0);
  vec2 cellIdx = floor(gl_FragCoord.xy / cellPx);
  vec2 cellCentre = (cellIdx + 0.5) * cellPx;
  vec2 g = fract(gl_FragCoord.xy / cellPx);

  vec2 suv = (2.0 * cellCentre - uRes) / min(uRes.x, uRes.y);
  float R = uP_radius;

  // organic silhouette, cut on the cell grid
  float mask = orbOrganicMask(suv, R, uP_organic, uP_edgeSoft, uP_edgeFlow);
  vec2 uv = orbRimUV(suv, R) / R;
  float z = sqrt(max(1.0 - dot(uv, uv), 0.0));
  vec3 n = vec3(uv, z);

  float cr = cos(uP_spin);
  float sr = sin(uP_spin);
  vec2 p2 = phgWrap(uv, cr, sr);

  // three motions, each on its own integrated clock
  float driftT = uP_drift;
  float scrollT = uP_scroll;
  float t = uP_speed;
  vec2 flow = vec2(driftT * 0.6, -driftT * 0.45 - scrollT);

  vec3 L = normalize(vec3(-0.45, 0.55, 0.7));
  float field = fbm(p2 + flow);
  float lambert = clamp(dot(n, L), 0.0, 1.0);
  float dens = clamp((field - 0.5) * 1.8 + densBias + 0.4 * uP_light * lambert
    + uP_pulse * 0.35 * sin(length(uv) * 5.5 - t * 2.4), 0.0, 1.0);

  // the glyph: four dash rows split by three stripe gaps, lit from the bottom
  float rowI = floor(g.y * 4.0);
  float bar = step(0.22, fract(g.y * 4.0)) * step(fract(g.y * 4.0), 0.9);
  float stripe = step(0.18, fract(g.x * 3.0));
  float lit = step(rowI + 0.5, dens * 4.0 * gainNow);
  float glyph = bar * stripe * lit;

  // blocky dropouts on a 2x2 super-grid
  vec2 superCentre = (floor(cellIdx / 2.0) * 2.0 + 1.0) * cellPx;
  vec2 sSuv = (2.0 * superCentre - uRes) / min(uRes.x, uRes.y);
  float superField = fbm(phgWrap(orbRimUV(sSuv, R) / R, cr, sr) + flow);
  float keep = step(uP_dropout, superField + 0.15 * uOutput);
  glyph *= keep;

  /*
    Flares: each cell has its own phase on a stepped flicker clock; in each
    epoch a hash (biased toward dense cells) picks a few to light every row
    and swell to white along a sine envelope.
  */
  float hc = hash(cellIdx * 1.37 + 3.1);
  float ft = uP_flicker + hc * 7.0;
  float fh = hash31(vec3(cellIdx, floor(ft)));
  float flareOn = step(1.0 - uP_flare * (0.15 + 0.85 * dens) * 0.35, fh) * keep * step(0.2, dens);
  float flare = flareOn * sin(3.14159 * fract(ft));
  float flareGlyph = bar * stripe * flare;

  // phosphor energy: dense glyphs run hot and whiten, flares go white
  float E = glyph * (0.2 + 0.55 * dens + 0.4 * smoothstep(0.75, 1.0, dens)) * burnNow;
  E = max(E, flareGlyph * (1.2 + 0.5 * burnNow));
  vec3 col = uC_deep * 0.55 + orbsyFluoro(E, uC_deep, uC_base, uC_hot) * max(glyph, flareGlyph);
  float gc = length(g - 0.5);
  col += orbsyFluoro(1.0, uC_deep, uC_base, uC_hot) * flare * exp(-gc * 4.0) * 0.8;

  /*
    Bloom: the same field per fragment at low octaves, with the dropout mask
    softened instead of snapped, lit only where it is bright.
  */
  vec2 fuv = orbUV();
  vec2 fu = orbRimUV(fuv, R) / R;
  float fz = sqrt(max(1.0 - dot(fu, fu), 0.0));
  float ff = phgFbm3(phgWrap(fu, cr, sr) + flow) + 0.045;
  float fdens = clamp((ff - 0.5) * 1.8 + densBias + 0.4 * uP_light * clamp(dot(vec3(fu, fz), L), 0.0, 1.0)
    + uP_pulse * 0.35 * sin(length(fu) * 5.5 - t * 2.4), 0.0, 1.0);
  float fkeep = smoothstep(uP_dropout - 0.1, uP_dropout + 0.1, ff + 0.15 * uOutput);
  float glowE = fdens * fkeep * min(gainNow, 1.6);
  glowE *= glowE;
  vec3 bloom = (uC_base * 0.7 + uC_hot * 0.2 * glowE) * glowE * uP_bloom * 0.3;
  col += bloom;

  // fresnel rim, gated by the local brightness so the limb never rings
  float fres = pow(1.0 - z, 2.2);
  col += uC_base * fres * uP_rim * (0.1 + 0.6 * fdens * fkeep);

  col = pow(max(col, 0.0), vec3(uP_contrast));

  /*
    Energy leaking off the screen, quantized into glyphs of its own. Scaled
    by a screen-space patch field and by the brightness at the rim point the
    cell reads, so the leak breaks into drifting clusters beside bright
    regions instead of a constant halo.
  */
  float patchF = mix(0.12, 1.0, smoothstep(0.38, 0.72, orbEdgeFbm(vec3(suv * 3.2, uP_edgeFlow * 0.45))));
  float bleedAmt = orbBleed(suv, R, uP_reach, uP_edgeFlow) * uP_bleed * (0.7 + 0.6 * uOutput)
    * patchF * (0.15 + 0.7 * sqrt(glowE));
  float leakField = fbm(suv * 4.0 + flow + vec2(0.0, -uP_edgeFlow * 0.5));
  float leakDens = clamp(bleedAmt * (0.15 + 1.4 * smoothstep(0.35, 0.75, leakField)), 0.0, 1.0) * (1.0 - mask);
  float leakGlyph = bar * stripe * step(rowI + 0.5, leakDens * 4.0);
  vec3 leak = orbsyFluoro(0.35 + 0.6 * leakDens, uC_deep, uC_base, uC_hot) * leakGlyph * leakDens;
  float fPatch = mix(0.12, 1.0, smoothstep(0.38, 0.72, orbEdgeFbm(vec3(fuv * 3.2, uP_edgeFlow * 0.45))));
  float haze = orbBleed(fuv, R, uP_reach, uP_edgeFlow) * uP_bleed * (0.7 + 0.6 * uOutput) * fPatch * glowE;
  leak += uC_base * haze * 0.2 * (1.0 - orbOrganicMask(fuv, R, uP_organic, uP_edgeSoft, uP_edgeFlow));

  vec3 total = col * mask + leak;

  // light CRT on top: scanlines, aperture grille, a slow roll bar
  float crt = uP_crt;
  total *= orbsyScanline(gl_FragCoord.xy, 3.0, 0.3 * crt);
  total *= orbsyPhosphorMask(gl_FragCoord.xy, 0.3 * crt);
  total += uC_base * orbsyRollBar(fuv, driftT + scrollT) * 0.1 * crt * mask * (0.3 + fdens);

  total = orbsyBloomTone(total, 1.0);
  float a = max(mask, clamp(max(total.r, max(total.g, total.b)) * 1.2, 0.0, 1.0));
  gl_FragColor = vec4(total, a);
}
`;

export const orbsy20Orb: OrbVariant = {
  key: "orbsy-20",
  label: "Phosphor Green",
  note: "SHDR-23's ASCII glyph weave burning fluoro green on a CRT, with white-hot flares",
  frag: ORBSY20_FRAG,
  params: [
    { key: "drift", label: "Drift", min: 0, max: 10, step: 0.05, default: 0.55, integrate: true },
    { key: "scroll", label: "Scroll", min: 0, max: 10, step: 0.05, default: 0.05, integrate: true },
    { key: "speed", label: "Pulse rate", min: 0.015, max: 10, step: 0.05, default: 0.5, integrate: true },
    { key: "pulse", label: "Pulse depth", min: 0, max: 2, step: 0.01, default: 0 },
    { key: "spin", label: "Roll", min: 0, max: 5, step: 0.03, default: 0.12, integrate: true },
    { key: "radius", label: "Radius", min: 0.15, max: 3, step: 0.015, default: 0.8 },
    { key: "cells", label: "Glyph grid", min: 16, max: 120, step: 2, default: 60 },
    { key: "scale", label: "Field scale", min: 0.3, max: 10, step: 0.1, default: 1.6 },
    { key: "density", label: "Glyph density", min: 0, max: 2, step: 0.01, default: 0.4 },
    { key: "dropout", label: "Dropout", min: 0, max: 1, step: 0.01, default: 0.4 },
    { key: "light", label: "Key light", min: 0, max: 3, step: 0.015, default: 0.9 },
    { key: "rim", label: "Rim glow", min: 0, max: 3, step: 0.015, default: 0.5 },
    { key: "gain", label: "Phosphor gain", min: 0.05, max: 5, step: 0.05, default: 1 },
    { key: "burn", label: "Burn", min: 0.2, max: 3, step: 0.01, default: 1.1 },
    { key: "flare", label: "Flares", min: 0, max: 1, step: 0.01, default: 0.3 },
    { key: "flicker", label: "Flare rate", min: 0, max: 10, step: 0.05, default: 1.2, integrate: true },
    { key: "bloom", label: "Bloom", min: 0, max: 2, step: 0.01, default: 0.8 },
    { key: "crt", label: "CRT", min: 0, max: 1, step: 0.01, default: 0.6 },
    { key: "contrast", label: "Contrast", min: 0.15, max: 10, step: 0.05, default: 1 },
    { key: "organic", label: "Rim wander", min: 0, max: 0.15, step: 0.005, default: 0.04 },
    { key: "edgeSoft", label: "Rim feather", min: 0, max: 0.2, step: 0.005, default: 0.035 },
    { key: "bleed", label: "Energy bleed", min: 0, max: 3, step: 0.01, default: 0.9 },
    { key: "reach", label: "Bleed reach", min: 0.02, max: 0.5, step: 0.005, default: 0.1 },
    { key: "edgeFlow", label: "Edge flow", min: 0, max: 3, step: 0.01, default: 0.35, integrate: true }
  ],
  colors: [
    { key: "deep", label: "Deep", default: "#010d04" },
    { key: "base", label: "Fluoro", default: "#39ff14" },
    { key: "hot", label: "Hot", default: "#d6ff5c" }
  ],
  statePresets: {
    // idle DRIFTS: a fine, sparse mesh streaming diagonally, lazy roll, rare flares
    idle: {
      drift: 0.55, scroll: 0.05, pulse: 0, speed: 0.52, spin: 0.12, cells: 68, scale: 5.1,
      density: 0.31, dropout: 0.24, light: 1.11, rim: 0.6, gain: 0.9, burn: 1.0, flare: 0.25,
      flicker: 0.9, bloom: 0.75, crt: 0.55, organic: 0.03, bleed: 0.7, reach: 0.08, edgeFlow: 0.3
    },
    // thinking STREAMS: fast drift over a steady scroll, nearly solid matrix, busy flares
    thinking: {
      drift: 3.05, scroll: 0.65, pulse: 0.58, speed: 0.45, spin: 0.04, cells: 86, scale: 5.1,
      density: 0.33, dropout: 0.13, light: 0.855, rim: 0.5, contrast: 1.3, gain: 0.95, burn: 1.0,
      flare: 0.55, flicker: 4.5, bloom: 0.85, crt: 0.75, organic: 0.045, bleed: 0.9, reach: 0.1,
      edgeFlow: 0.8
    },
    // speaking PULSES: hard radial waves, heavy dropout, phosphor burning white
    speaking: {
      drift: 0.4, scroll: 0.1, pulse: 1.27, speed: 2.85, spin: 1.05, cells: 110, scale: 7.2,
      density: 0.56, dropout: 0.55, light: 0.39, rim: 0.25, gain: 2.95, burn: 0.85, flare: 0.7,
      flicker: 2.4, bloom: 0.95, crt: 0.5, organic: 0.06, bleed: 1.3, reach: 0.13, edgeFlow: 1.1
    }
  },
  stateColors: {
    idle: { deep: "#010d04", base: "#39ff14", hot: "#d6ff5c" },
    thinking: { deep: "#010f08", base: "#2bff6a", hot: "#c4ffd0" },
    speaking: { deep: "#020f02", base: "#5cff1f", hot: "#eaff80" }
  }
};

export type Orbsy20Props = Omit<ShaderOrbProps, "variant">;

export function Orbsy20({ size = 280, ...rest }: Orbsy20Props) {
  return <ShaderOrb variant={orbsy20Orb} size={size} {...rest} />;
}

export default Orbsy20;
