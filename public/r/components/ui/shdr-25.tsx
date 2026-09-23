/*
 * Shader by XorDev (https://x.com/XorDev), ported for Orbkit with the author's
 * permission. Non-commercial use only, with attribution to XorDev; keep this
 * notice with the file. Orbkit's runtime (orbkit-core.tsx) is MIT-licensed.
 */
/*
 * Deliberately not a `"use client"` module — see the note in `shdr-11.tsx`.
 *
 * Note for editors: the shader lives in a template literal, so its comments
 * must not contain backticks.
 */
import { ShaderOrb, type OrbVariant, type ShaderOrbProps } from "@/components/ui/orbkit-core";

/* ----------------------------------------------------------------------------
   SHDR-25 — the folds of a warped field, drawn by their own steepness.

   Ported from a one-line twigl listing:

     vec2 p=FC.xy/r.y*2e1+t;
     for(float i;i++<8.;)
       p+=sin(p+t/.2+i)*.4,
       p*=mat2(6,-8,8,6)/9.;
     o=vec4(tanh(length(fwidth(sin(p*.3)/.1))),texture(b,FC.xy/r));

   What it actually is, decoded:

   - THE IMAGE IS A DERIVATIVE. Nothing here draws a shape; it measures how
     fast a rippled field changes from one pixel to the next and paints
     that. Where eight octaves of warp have folded the plane onto itself
     the field races, and those folds come out as bright filigree. Where it
     is stretched flat, nothing.
   - mat2(6,-8,8,6)/9 IS AN EXACT SIMILARITY, and it is the neatest thing
     in the listing. 6-8-10 is a Pythagorean triple, so that matrix is
     precisely a rotation through the 3-4-5 angle — about 53.13 degrees —
     times a scale of 10/9. Rotating between octaves is the standard way to
     stop a warp from lining up with the axes; doing it with integers and
     one divide is not.
   - THE CLOCK RUNS TWICE. t translates the whole field once at the start,
     and t/.2 — five times faster — drives the warp inside every octave, so
     the pattern drifts slowly while its detail boils.
   - vec4(scalar, texture(...)) puts the derivative in RED and takes green,
     blue and alpha from the previous frame.

   Port decisions, each one a documented trap or rule in the README:

   - fwidth() CANNOT BE USED. It needs OES_standard_derivatives in WebGL 1,
     and the #extension directive that enables it cannot legally follow the
     prelude's declarations — the README says so, and shdr-28 works
     around it by deriving its pixel footprint analytically. There is no
     analytic footprint through eight octaves of feedback warp, so the
     derivative is taken by FINITE DIFFERENCES instead: evaluate the whole
     chain at the two neighbouring pixel centres and difference. Three
     evaluations rather than one, and closer to the truth than fwidth,
     which is constant across each 2x2 quad.
   - THE FEEDBACK TERM IS NOT PORTED. One pass, one canvas, no
     previous-frame texture (the same limit as shdr-09). Green and blue
     arrive only from that line, so without a substitute this orb would be
     red and nothing else — the derivative is instead run through a palette
     keyed to the field itself.
   - THE ORB IS THE OBJECT: a flat 2D field, so it is sampled through a
     stereographic projection of the dome, and motion is projection-safe
     2D as in shdr-08. That wrap pays for itself twice here — because the
     measurement is a SCREEN-SPACE derivative, the projection's own
     compression toward the limb steepens the field there, so the filigree
     tightens at the rim exactly the way a texture on a real sphere would.
   - The golfed listing relies on i starting at zero; uninitialised locals
     are UNDEFINED in GLSL ES 1.0, explicit here.
   - Surface-lit and mask-bounded, so alpha IS coverage — premultiplied
     output, as in shdr-17.
   - THE EDGE IS NOT A CUT. The field is defined past the dome too (the
     projection just flattens there), so the silhouette wanders and
     feathers, and the creases themselves are drawn on out past the rim
     as bare filigree with no body under it, faded by a tendril falloff
     (spill) — the folds escape the ball rather than a glow painted round
     it. A thin tendril glow in the ball's own rim colour (bleed) sits
     under that. spill 0, wander 0 and bleed 0 give back the hard ball.
---------------------------------------------------------------------------- */

/*
 * Step counts are `#define`s: ES 1.0 requires constant loop bounds. OCTAVES
 * is the listing's i++ < 8. The finite difference costs three passes of it
 * per sample, so this is 24 warp steps before supersampling.
 */
const CREASE_FRAG = `
#define OCTAVES 8
#define AA 2

// Volume-reactive values, resolved once per fragment in main().
float creaseWarp;
float creaseGain;

// GLSL ES 1.0 has no scalar tanh; the prelude ships the vec3 form only.
float tanh1(float x) {
  x = clamp(x, -10.0, 10.0);
  float e = exp(2.0 * x);
  return (e - 1.0) / (e + 1.0);
}

/*
  The whole chain for one pixel centre: dome, stereographic wrap, then the
  eight-octave warp. Called three times per sample so the derivative below
  can be differenced — see the header for why fwidth is unavailable.
*/
vec2 creaseField(vec2 fragCoord, float t, float drift, float sw) {
  vec2 uv = (2.0 * fragCoord - uRes) / min(uRes.x, uRes.y);
  vec2 pl = uv / max(uP_radius, 0.001);
  float z = sqrt(max(1.0 - dot(pl, pl), 0.0));

  vec2 p = pl / (z + 1.0 + uP_bulge) * uP_scale;
  p = mat2(cos(sw), -sin(sw), sin(sw), cos(sw)) * p;
  p += drift;

  /*
    The listing's matrix, decomposed. mat2(6,-8,8,6)/9 is exactly
    (10/9) * mat2(.6,-.8,.8,.6), and that second factor is a true rotation
    because 6-8-10 is a Pythagorean triple — so the octave transform is a
    rotation through the 3-4-5 angle times a clean zoom, with the zoom
    pulled out as a slider.
  */
  for (int i = 0; i < OCTAVES; i++) {
    float fi = float(i) + 1.0;
    p += sin(p + t + fi) * creaseWarp;
    p = uP_zoom * (mat2(0.6, -0.8, 0.8, 0.6) * p);
  }

  return p;
}

/*
  The creases alone, per channel, before any body or lighting: what is left
  of the orb once it runs out past the rim.
*/
vec3 creaseLines(vec2 fragCoord) {
  float t = uP_speed;      // integrated clock: the boil
  float drift = uP_drift;  // integrated clock: the slow travel
  float sw = uP_swirl;     // integrated clock

  /*
    The three taps the difference needs. uP_blur is how far apart they sit:
    at one pixel this is fwidth exactly, and wider is a deliberate blur —
    the derivative of a folded field is a hairline, and a rim wants width.
  */
  vec2 p0 = creaseField(fragCoord, t, drift, sw);
  vec2 px = creaseField(fragCoord + vec2(uP_blur, 0.0), t, drift, sw);
  vec2 py = creaseField(fragCoord + vec2(0.0, uP_blur), t, drift, sw);

  /*
    fwidth, by hand and once per channel. The sum of the absolute
    differences on each axis is exactly what the built-in returns — but
    taking it three times at slightly offset ripple phases puts each
    channel's rim in a slightly different place, which is where the warm
    and cool fringes on the edges come from. One field evaluation still
    serves all three.
  */
  vec3 e;
  for (int c = 0; c < 3; c++) {
    float ph = float(c) * uP_fringe;
    vec2 v0 = sin(p0 * uP_ripple + ph);
    vec2 d = abs(sin(px * uP_ripple + ph) - v0)
           + abs(sin(py * uP_ripple + ph) - v0);
    float m = tanh1(length(d) * creaseGain / max(uP_exposure, 0.001));
    if (c == 0) e.r = m;
    else if (c == 1) e.g = m;
    else e.b = m;
  }

  return pow(clamp(e, 0.0, 1.0), vec3(uP_contrast));
}

vec3 creaseRender(vec2 fragCoord) {
  vec3 col = uC_tint * creaseLines(fragCoord);

  // a dark body under the filigree, so the flat regions read as the ball
  col += uC_body * uP_floorLevel;

  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(lum), col, uP_saturation);

  // dome shading keeps the ball a ball under the folds
  vec2 pl = ((2.0 * fragCoord - uRes) / min(uRes.x, uRes.y)) / max(uP_radius, 0.001);
  float z = sqrt(max(1.0 - dot(pl, pl), 0.0));
  vec3 n = vec3(pl, z);
  float lambert = clamp(dot(n, normalize(vec3(-0.45, 0.55, 0.72))), 0.0, 1.0);
  col *= 0.62 + uP_light * lambert;

  float fres = 1.0 - z;
  fres = fres * fres * fres;
  col += uC_sheen * uP_rim * fres;

  return col;
}

void main() {
  // Volume coupling: the user's voice folds the field harder, the agent's
  // steepens what counts as a crease.
  creaseWarp = uP_warp * (1.0 + 0.4 * uInput);
  creaseGain = uP_edgeGain * (1.0 + 0.5 * uOutput);

  vec2 uv = orbUV();
  float R = max(uP_radius, 0.001);
  float r = length(uv);
  // organic silhouette: the rim wanders and feathers instead of a hard cut
  float mask = orbOrganicMask(uv, R, uP_organic, uP_edgeSoft, uP_edgeFlow);

  // Past the rim only the spill and the bleed can light; beyond their reach
  // (or the frame) none of the warp steps are worth paying for.
  bool far = (r - R) / R > 7.0 * max(max(uP_spill, uP_reach), 0.02);
  float outside = 1.0 - mask;
  if (mask <= 0.0 && (far || r >= 1.0)) {
    gl_FragColor = vec4(0.0);
    return;
  }

  // Past the true radius the ball's colour comes from the rim just below,
  // so the wandering lumps and the bleed carry the orb's real edge colour.
  vec3 col = vec3(0.0);
  if (r > R * 0.96) {
    col = creaseRender(orbFragCoord(orbRimUV(uv, R)));
  } else {
#if AA > 1
    for (int mx = 0; mx < AA; mx++) {
      for (int my = 0; my < AA; my++) {
        vec2 off = (vec2(float(mx), float(my)) + 0.5) / float(AA) - 0.5;
        col += creaseRender(gl_FragCoord.xy + off);
      }
    }
    col /= float(AA * AA);
#else
    col = creaseRender(gl_FragCoord.xy);
#endif
  }
  col = max(col, vec3(0.0));

  /*
    The escaping folds: the crease field evaluated at the pixel itself past
    the rim, lines only, so bright filigree runs on out of the ball and the
    flat regions between stay clear. It varies in both directions, so it
    never smears into radial rays the way a rim-sampled colour does.
  */
  vec3 escape = vec3(0.0);
  if (outside > 0.0 && uP_spill > 0.0) {
    // cubed, so only true creases escape: the soft broad slopes of a calm
    // field would otherwise leave the ball as a uniform haze
    vec3 e = creaseLines(gl_FragCoord.xy);
    vec3 lines = uC_tint * e * e * e;
    float sl = dot(lines, vec3(0.299, 0.587, 0.114));
    lines = max(mix(vec3(sl), lines, uP_saturation), vec3(0.0));
    float sf = orbBleed(uv, R, uP_spill * (0.8 + 0.5 * uOutput), uP_edgeFlow + 3.7);
    escape = lines * sf * outside;
  }

  // a thin tendril glow in the rim colour, swelling with the voice
  float bl = orbBleed(uv, R, uP_reach, uP_edgeFlow) * uP_bleed * (0.7 + 0.6 * uOutput);
  vec3 glow = mix(uC_sheen, col, 0.5) * bl * outside + escape;

  // Surface orb bounded by a mask: alpha IS coverage, so premultiply — the
  // opposite convention from the emissive orbs (see shdr-31). What escapes
  // is emitted light, alpha from its peak channel.
  float a = max(mask, clamp(max(glow.r, max(glow.g, glow.b)), 0.0, 1.0));
  gl_FragColor = vec4(col * mask + glow, a);
}
`;

export const shdr25Orb: OrbVariant = {
  key: "shdr-25",
  label: "SHDR-25",
  note: "the folds of a warped field, drawn by their own steepness",
  frag: CREASE_FRAG,
  params: [
    { key: "speed", label: "Boil", min: 0.015, max: 20, step: 0.05, default: 3, integrate: true },
    { key: "drift", label: "Drift", min: 0, max: 8, step: 0.02, default: 0.6, integrate: true },
    { key: "swirl", label: "Swirl", min: 0, max: 3, step: 0.015, default: 0.05, integrate: true },
    { key: "radius", label: "Radius", min: 0.15, max: 3, step: 0.015, default: 0.8 },
    { key: "scale", label: "Cell scale", min: 0.3, max: 60, step: 0.1, default: 7.5 },
    { key: "bulge", label: "Dome bulge", min: 0, max: 4, step: 0.02, default: 0.3 },
    { key: "warp", label: "Fold", min: 0, max: 2, step: 0.01, default: 0.4 },
    { key: "zoom", label: "Octave zoom", min: 0.6, max: 2, step: 0.005, default: 1.111 },
    { key: "ripple", label: "Ripple", min: 0.02, max: 3, step: 0.01, default: 0.3 },
    { key: "edgeGain", label: "Edge gain", min: 0.5, max: 60, step: 0.5, default: 10 },
    { key: "blur", label: "Rim width", min: 0.5, max: 12, step: 0.25, default: 2.5 },
    { key: "fringe", label: "Chromatic fringe", min: 0, max: 1.5, step: 0.005, default: 0.09 },
    { key: "exposure", label: "Exposure", min: 0.05, max: 40, step: 0.05, default: 0.8 },
    { key: "contrast", label: "Contrast", min: 0.15, max: 8, step: 0.05, default: 1.15 },
    { key: "saturation", label: "Saturation", min: 0, max: 4, step: 0.02, default: 1.5 },
    { key: "floorLevel", label: "Body fill", min: 0, max: 2, step: 0.01, default: 0.16 },
    { key: "light", label: "Key light", min: 0, max: 3, step: 0.015, default: 0.35 },
    { key: "rim", label: "Rim sheen", min: 0, max: 3, step: 0.015, default: 0.45 },
    { key: "spill", label: "Crease spill", min: 0, max: 0.5, step: 0.005, default: 0.1 },
    { key: "organic", label: "Rim wander", min: 0, max: 0.15, step: 0.005, default: 0.04 },
    { key: "edgeSoft", label: "Rim feather", min: 0, max: 0.2, step: 0.005, default: 0.03 },
    { key: "bleed", label: "Energy bleed", min: 0, max: 3, step: 0.01, default: 0.3 },
    { key: "reach", label: "Bleed reach", min: 0.02, max: 0.5, step: 0.005, default: 0.07 },
    { key: "edgeFlow", label: "Edge flow", min: 0, max: 3, step: 0.01, default: 0.35, integrate: true }
  ],
  colors: [
    { key: "tint", label: "Rim", default: "#dbe8f7" },
    { key: "body", label: "Body", default: "#0d1118" },
    { key: "sheen", label: "Sheen", default: "#a8c8f0" }
  ],
  /*
    Staged on the FOLD, which is what makes creases exist at all, and on
    edge gain, which decides how steep a slope has to be to count as one.
    Cell scale moves only for the answer — it sets how much pattern is on
    the ball, and as it glides in the ball reads as inflating; that is the
    answer's entrance.
  */
  statePresets: {
    // at rest: a slow boil, folds moderate, rims clean — the octave zoom
    // pulled in a touch under the default and the edge gain a quarter up,
    // so slightly gentler slopes count as creases
    idle: {
      speed: 3,
      drift: 0.6,
      swirl: 0.05,
      warp: 0.4,
      zoom: 1.07,
      edgeGain: 12.5,
      exposure: 0.8,
      contrast: 1.15,
      spill: 0.08,
      organic: 0.03,
      edgeSoft: 0.03,
      bleed: 0.25,
      reach: 0.06,
      edgeFlow: 0.3
    },
    /*
      searching: the folds RELAX a touch below idle, but the edge gain
      nearly triples so even the shallowest slope lights up as a crease,
      on a boil half again idle's. The ripple tightens, the rim widens with
      more than double the chromatic fringe, and the saturation, key light
      and rim sheen all come up — every cell rims at once in colour, and
      none of it settles.
    */
    thinking: {
      speed: 4.7,
      drift: 0.15,
      swirl: 0.02,
      bulge: 0.38,
      warp: 0.34,
      zoom: 1.12,
      ripple: 0.18,
      edgeGain: 33,
      blur: 2.75,
      fringe: 0.2,
      exposure: 0.55,
      contrast: 1.5,
      saturation: 2,
      light: 0.525,
      rim: 0.69,
      spill: 0.1,
      organic: 0.045,
      edgeSoft: 0.03,
      bleed: 0.3,
      reach: 0.07,
      edgeFlow: 0.9
    },
    /*
      answering: the field FOLDS hardest of the three and the gain drops to
      under a sixth of the thinking state, so the creases are deep but only
      the steepest rims light. The cell scale is pushed past idle's and the
      dome bulged to near a hemisphere, the swirl opened an order of
      magnitude, the ripple widened — a slow, heavy, swirling boil, with
      the exposure tripled so what does light, burns.
    */
    speaking: {
      speed: 1.4,
      drift: 0.8,
      swirl: 0.6,
      scale: 11.5,
      bulge: 2.22,
      warp: 1.55,
      zoom: 0.945,
      ripple: 1.18,
      edgeGain: 5,
      blur: 2,
      fringe: 0.23,
      exposure: 2.35,
      contrast: 1.35,
      spill: 0.16,
      organic: 0.06,
      edgeSoft: 0.035,
      bleed: 0.5,
      reach: 0.08,
      edgeFlow: 1.1
    }
  },
  // cool steel at rest, cold indigo for both working states — the answer
  // is told apart by its fold and scale, not its colour
  stateColors: {
    idle: { tint: "#dbe8f7", body: "#0d1118", sheen: "#a8c8f0" },
    thinking: { tint: "#c2d6f5", body: "#090d1c", sheen: "#8fb4f2" },
    speaking: { tint: "#c2d6f5", body: "#090d1c", sheen: "#8fb4f2" }
  }
};

export type Shdr25Props = Omit<ShaderOrbProps, "variant">;

export function Shdr25({ size = 280, ...rest }: Shdr25Props) {
  return <ShaderOrb variant={shdr25Orb} size={size} {...rest} />;
}

export default Shdr25;
