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
import { ShaderOrb, type OrbVariant, type ShaderOrbProps } from "../core/orbkit-core";

/* ----------------------------------------------------------------------------
   SHDR-06 — a hundred glowing lattices stacked through the depth of the ball,
   interfering.

   Ported from a one-line twigl listing:

     vec2 p=(FC.xy*2.-r)/r.y/.3;
     for(float f;f++<1e2;p+=.02*sin(p.yx+.5*t))
       o+=(cos(f/27.+vec4(0,1,3,0))+1.1)/length(sin(p*sin(r+f)/.7));
     o=tanh(o*o/4e4);

   What it actually is, decoded:

   - Each iteration draws ONE LATTICE OF GLOWS. sin(p*k) hits zero wherever
     both components do, which is a rectangular grid of points, and
     1/length of it lights every one of them. A hundred iterations lay a
     hundred such grids over each other, and the interference between
     their spacings is the whole image — moire in the strict sense.
   - sin(r+f) is the SEED. r is the resolution and f the layer index, so
     each layer gets its own frequency pair out of a sine of an integer —
     the cheapest pseudo-random vector in shader golf. It is also why the
     grids are axis-aligned but never the same size twice.
   - The loop's increment, p += .02*sin(p.yx+.5t), walks the sample point a
     little between layers, so the stack is not a hundred concentric grids
     but a hundred grids each shifted a little further along a wandering
     path. That is what turns the interference from static moire into
     something that flows.
   - cos(f/27 + vec4(0,1,3,0)) + 1.1 tints by LAYER INDEX, so depth through
     the stack reads as hue.
   - o*o before the knee is a contrast squarer, not a tone map: it crushes
     the field between the glows and lets the glows themselves saturate.

   Port decisions, each one a documented trap or rule in the README:

   - THE ORB IS THE OBJECT: the hundred layers become a hundred DEPTHS
     inside the ball rather than a hundred copies of one texture. Layer at
     depth d is the stereographic projection of the point the view ray has
     reached there, closed form —
     st = pl / (z - d + (1+bulge)*|P|), |P|^2 = 1 - 2*d*z + d*d.
     Be precise about what that is: a depth-graded REPROJECTION, not
     refraction. It grades radially, identical for every layer at the dead
     centre and spread hardest at the limb, which is why the layers all
     agree in the middle of the ball and light it as a focal point. What
     it buys is the one thing a flat texture cannot have — layers that
     shear against each other as they drift instead of sliding as one
     sheet.
   - The listing's sin(r+f) seed is RESOLUTION DEPENDENT and, unlike the
     lattice term in shdr-26, nothing cancels it: every layer would be
     reseeded on a canvas resize. Replaced with a constant.
   - Choosing that constant is not arbitrary. The two components differ
     only by a fixed phase, so the frequency pair traces a closed curve in
     frequency space rather than filling it — inherent to the listing. A
     quarter-turn offset makes that curve a CIRCLE, so every lattice
     aspect gets equal time; an arbitrary offset collapses it toward a
     line and half the layers come out near-identical.
   - length(sin(...)) is exactly zero at every lattice point, which is the
     one place the listing wants to divide. Floored rather than guarded,
     and the floor doubles as the GLOW SIZE — the same trick as
     shdr-02's coreClamp and shdr-09's ring width.
   - The golfed listing relies on f starting at zero; uninitialised locals
     are UNDEFINED in GLSL ES 1.0, explicit here.
   - Surface-lit and mask-bounded, so alpha IS coverage — premultiplied
     output, as in shdr-17.
---------------------------------------------------------------------------- */

/*
 * Step counts are `#define`s: ES 1.0 requires constant loop bounds. LAYERS is
 * the listing's f++ < 1e2. The field is broad and smooth — each lattice puts
 * only a handful of zeros across the ball — so this one does not need
 * supersampling the way the thin-line orbs do.
 */
const MOIRE_FRAG = `
#define LAYERS 100
#define AA 1

/*
 * The listing's sin(r + f), minus the resolution. The components are a
 * quarter turn apart so the per-layer frequency pair walks a circle (see
 * the header) — the base value only sets where on that circle layer one
 * starts.
 */
const vec2 SEED = vec2(11.3, 12.87);

// Volume-reactive values, resolved once per fragment in main().
float moireDrift;
float moireGlow;
float moireHue;

vec3 moireRender(vec2 fragCoord) {
  vec2 uv = (2.0 * fragCoord - uRes) / min(uRes.x, uRes.y);
  float R = max(uP_radius, 0.001);

  // the dome: the front hemisphere of a unit ball, in screen space
  vec2 pl = uv / R;
  float z = sqrt(max(1.0 - dot(pl, pl), 0.0));

  float t = uP_speed; // integrated clock

  /*
    The layer-zero projection: the plain stereographic wrap of the dome's
    surface. Every deeper layer is this divided by its own denominator, so
    the whole parallax below costs one ratio per layer.
  */
  float bulge = 1.0 + uP_bulge;
  float den0 = z + bulge;

  vec2 w = pl / den0 * uP_scale;

  vec3 acc = vec3(0.0);

  for (int li = 0; li < LAYERS; li++) {
    float f = float(li) + 1.0;
    float u = f / float(LAYERS);

    /*
      This layer's depth along the view ray, and the projection from the
      point the ray has reached there. At depth 0 the denominator is den0
      and the ratio is 1; deeper layers see the pattern from further
      inside the ball, which spreads them at the limb and not at all
      through the centre. That gradient is what shears the stack.
    */
    float d = u * uP_depth;
    float denu = z - d + bulge * sqrt(max(1.0 - 2.0 * d * z + d * d, 0.0));
    vec2 q = w * (den0 / max(denu, 0.05));

    /*
      One lattice. sin(q * k) vanishes on a rectangular grid of points and
      the reciprocal of its length lights every one; the floor on that
      length is the glow's radius, and without it the divide is by exactly
      zero at every lattice point.
    */
    vec2 k = sin(SEED + f) / max(uP_freq, 0.001);
    float g = max(length(sin(q * k)), moireGlow);

    // tint by layer index — depth through the stack reads as hue
    vec3 hue = cos(f * moireHue + vec3(0.0, 1.0, 3.0)) + 1.1;

    acc += hue / g;

    // the listing's walk between layers: the stack is a hundred grids
    // each shifted a little further along a wandering path
    w += moireDrift * sin(w.yx + t);
  }

  /*
    The listing's knee is tanh(o*o/4e4) over an unnormalized sum of a
    hundred layers. Dividing by the layer count first pulls the square's
    scale down by 100*100, so the same knee is exactly 4 here — a number
    that fits on a slider. The square is a contrast squarer, not a tone
    map: it crushes the field between the glows.
  */
  vec3 v = acc / float(LAYERS);
  vec3 col = tanh3(v * v / max(uP_exposure, 0.0001));
  col = pow(clamp(col, 0.0, 1.0), vec3(uP_contrast));

  // saturation about luminance, then the tint
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(lum), col, uP_saturation);
  col *= uC_tint;

  /*
    Dome shading, kept gentle: the layers are emission seen THROUGH the
    ball, so a hard lambert reads as a shadow thrown across the inside of
    a lamp rather than as a lit surface.
  */
  vec3 n = vec3(pl, z);
  float lambert = clamp(dot(n, normalize(vec3(-0.45, 0.55, 0.72))), 0.0, 1.0);
  col *= 0.6 + uP_light * lambert;

  float fres = 1.0 - z;
  fres = fres * fres * fres;
  col += uC_sheen * uP_rim * fres;

  return col;
}

vec3 moireAt(vec2 fc) {
  vec3 col = vec3(0.0);
#if AA > 1
  for (int mx = 0; mx < AA; mx++) {
    for (int my = 0; my < AA; my++) {
      vec2 off = (vec2(float(mx), float(my)) + 0.5) / float(AA) - 0.5;
      col += moireRender(fc + off);
    }
  }
  col /= float(AA * AA);
#else
  col = moireRender(fc);
#endif
  return max(col, vec3(0.0));
}

// The rim point below uv, turned by ang about the centre.
vec2 edgeTap(vec2 uv, float R, float ang) {
  vec2 q = orbRimUV(uv, R);
  float c = cos(ang);
  float s = sin(ang);
  return vec2(q.x * c - q.y * s, q.x * s + q.y * c);
}

void main() {
  // Volume coupling: the user's voice widens the walk between layers, the
  // agent's opens the glows and runs the hue through the stack faster.
  moireDrift = uP_drift * (1.0 + 0.6 * uInput);
  moireGlow = max(uP_glowSize * (1.0 - 0.3 * uOutput), 0.002);
  moireHue = uP_hueRate * (1.0 + 0.35 * uOutput);

  /*
    Organic edge: the silhouette was a two-pixel smoothstep on length(uv), a
    circle stamp. It now wanders and feathers (orbOrganicMask), and pixels
    past the true radius render the lattice at the rim point below them
    (orbRimUV), so the lumps and the bleed beyond carry the stack's real
    edge colour. A rim sample is constant along the radius, so the lattice
    lines would smear into radial spikes: out there the colour is averaged
    over rim taps whose angular spread widens with distance.
  */
  vec2 uv = orbUV();
  float R = max(uP_radius, 0.001);
  float mask = orbOrganicMask(uv, R, uP_organic, uP_edgeSoft, uP_edgeFlow);
  float bleed = orbBleed(uv, R, uP_reach, uP_edgeFlow) * uP_bleed * (0.7 + 0.6 * uOutput);

  // A hundred lattices per sample, none of them worth paying for where
  // neither the body nor its bleed can reach.
  if (mask <= 0.0 && bleed < 0.002) {
    gl_FragColor = vec4(0.0);
    return;
  }

  vec3 col = moireAt(orbFragCoord(orbRimUV(uv, R)));
  float spread = 2.5 * max(length(uv) - 0.96 * R, 0.0) / R;
  if (spread > 0.0) {
    col = col * 0.4 + 0.3 * (moireAt(orbFragCoord(edgeTap(uv, R, spread)))
                           + moireAt(orbFragCoord(edgeTap(uv, R, -spread))));
  }

  // Energy creeping out past the rim in the lattice's own light, swelling
  // with the agent's voice.
  vec3 glow = col * bleed * (1.0 - mask);
  float glowA = clamp(max(glow.r, max(glow.g, glow.b)), 0.0, 1.0);

  // Surface orb bounded by a mask: alpha IS coverage, so premultiply — the
  // opposite convention from the emissive orbs (see shdr-31).
  gl_FragColor = vec4(col * mask + glow, max(mask, glowA));
}
`;

export const shdr06Orb: OrbVariant = {
  key: "shdr-06",
  label: "SHDR-06",
  note: "a hundred glowing lattices stacked through the ball, interfering",
  frag: MOIRE_FRAG,
  params: [
    { key: "speed", label: "Anim speed", min: 0.015, max: 10, step: 0.05, default: 0.5, integrate: true },
    { key: "drift", label: "Layer walk", min: 0, max: 0.3, step: 0.002, default: 0.02 },
    { key: "radius", label: "Radius", min: 0.15, max: 3, step: 0.015, default: 0.8 },
    { key: "scale", label: "Pattern scale", min: 0.3, max: 20, step: 0.1, default: 4 },
    { key: "bulge", label: "Dome bulge", min: 0, max: 4, step: 0.02, default: 0.3 },
    { key: "depth", label: "Stack depth", min: 0, max: 1.6, step: 0.01, default: 0.7 },
    { key: "freq", label: "Lattice spacing", min: 0.05, max: 5, step: 0.01, default: 0.7 },
    { key: "glowSize", label: "Glow size", min: 0.002, max: 1, step: 0.002, default: 0.05 },
    { key: "hueRate", label: "Hue per layer", min: 0, max: 0.5, step: 0.002, default: 0.037 },
    { key: "exposure", label: "Exposure", min: 0.05, max: 200, step: 0.05, default: 4 },
    { key: "contrast", label: "Contrast", min: 0.15, max: 10, step: 0.05, default: 1.1 },
    { key: "saturation", label: "Saturation", min: 0, max: 4, step: 0.02, default: 1.2 },
    { key: "light", label: "Key light", min: 0, max: 3, step: 0.015, default: 0.45 },
    { key: "rim", label: "Rim sheen", min: 0, max: 3, step: 0.015, default: 0.4 },
    { key: "organic", label: "Rim wander", min: 0, max: 0.15, step: 0.005, default: 0.04 },
    { key: "edgeSoft", label: "Rim feather", min: 0, max: 0.2, step: 0.005, default: 0.035 },
    { key: "bleed", label: "Energy bleed", min: 0, max: 3, step: 0.01, default: 0.9 },
    { key: "reach", label: "Bleed reach", min: 0.02, max: 0.5, step: 0.005, default: 0.1 },
    { key: "edgeFlow", label: "Edge flow", min: 0, max: 3, step: 0.01, default: 0.35, integrate: true }
  ],
  colors: [
    { key: "tint", label: "Tint", default: "#ffffff" },
    { key: "sheen", label: "Sheen", default: "#bcd8ff" }
  ],
  /*
    Staged on the two controls that decide what the interference looks
    like: the WALK between layers, which sets how far the stack shears
    against itself, and the GLOW SIZE, which sets whether the lattice
    points read as pinpricks or as flooded light.

    The clock is staged hard alongside them, and the two are doing separate
    jobs: the walk is the AMPLITUDE of the shear and the clock is its RATE,
    so a state's character comes from the pair. Small walk on a fast clock
    twitches; a large walk on a fast clock churns.

    Lattice spacing never moves between states — it sets how many grids land
    on the ball, and a gliding count reads as the ball inflating rather than
    as a mood.
  */
  statePresets: {
    // at rest: a slow shallow walk, glows open and soft
    idle: {
      speed: 0.5,
      drift: 0.02,
      depth: 0.7,
      glowSize: 0.05,
      hueRate: 0.037,
      exposure: 4,
      contrast: 1.1,
      organic: 0.03,
      bleed: 0.7,
      reach: 0.08,
      edgeFlow: 0.3
    },
    /*
      searching: quick and granular. The clock runs over five times resting
      speed and the walk is five times as wide, on the deepest stack of the
      three, so the hundred layers shear hard and visibly against each
      other. The glows stay small — a third of resting — which is what keeps
      the movement legible as movement: at this rate, fine points shifting
      read as a scan across the ball rather than as a wash.

      The DOME is pushed out hard too — bulge seven times its default, and
      the only state that moves it. That deepens the denominator the whole
      projection divides by, so the lattice lands finer on the ball and
      spreads less toward the limb: the grain tightens and evens out at the
      same time.
    */
    thinking: {
      speed: 2.6,
      drift: 0.105,
      bulge: 2.18,
      depth: 1.25,
      glowSize: 0.016,
      hueRate: 0.095,
      exposure: 6.5,
      contrast: 1.55,
      organic: 0.045,
      bleed: 0.9,
      reach: 0.1,
      edgeFlow: 0.8
    },
    /*
      answering: the fastest clock of the three and the widest walk, but on
      the SHALLOWEST stack — a third of resting's — so the hundred layers
      barely disagree and travel nearly as one. That is what keeps it
      readable at this rate: a coherent lattice walked hard, rather than a
      hundred of them shearing apart into grain the way searching does.

      The glows stay small, only a little over resting, so the lattice keeps
      its points instead of flooding. What carries the state instead is the
      KEY LIGHT, up to two and a half times its default and the only state
      that touches it — enough dome shading that the flow reads as crossing
      a lit ball rather than as a flat lamp changing pattern.
    */
    speaking: {
      speed: 4.5,
      drift: 0.13,
      depth: 0.26,
      glowSize: 0.062,
      hueRate: 0.045,
      exposure: 2.7,
      contrast: 0.9,
      light: 1.11,
      organic: 0.06,
      bleed: 1.3,
      reach: 0.13,
      edgeFlow: 1.1
    }
  },
  // the layer ramp supplies its own rainbow, so the tint only shifts its
  // temperature: neutral at rest, cooled while searching, warmed while
  // answering
  stateColors: {
    idle: { tint: "#ffffff", sheen: "#bcd8ff" },
    thinking: { tint: "#9db8ff", sheen: "#7ea9ff" },
    speaking: { tint: "#ffc492", sheen: "#ffb277" }
  }
};

export type Shdr06Props = Omit<ShaderOrbProps, "variant">;

export function Shdr06({ size = 280, ...rest }: Shdr06Props) {
  return <ShaderOrb variant={shdr06Orb} size={size} {...rest} />;
}

export default Shdr06;
