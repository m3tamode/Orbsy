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
   SHDR-01 — a cut-glass orb whose own shell does the dispersing.

   Ported from a golfed twigl listing:

     for(float i,z,d,s;i++<2e1;o+=(cos(s-z+vec4(0,1,8,0))+1.)/d){
       vec3 p=z*normalize(FC.rgb*2.-r.xyy),a=p;
       for(d=2.;d++<7.;)a-=sin(a*d+t+i).yzx/d;
       z+=d=abs(2.-max(p=abs(p),p.y).x)+abs(cos(s=a.z+a.y-t))/7.;}
     o=tanh(o/2e2);

   What it actually is, decoded:

   - abs(2. - max(|x|,|y|)) is an infinite SQUARE TUBE along z, half-width 2,
     and the camera sits at the origin inside it — an endless glowing tunnel.
   - abs(cos(a.z + a.y - t))/7. adds translucent SHEETS wherever the warped
     field crosses cos zero; the march slows there, and since each step is
     weighted 1/d, slow means bright.
   - cos(s - z + vec4(0,1,8,0)) reads one palette phase per channel — that
     per-channel offset is the whole "dispersion": the sheets split into
     rainbow striations, coupled to depth through the -z term.

   Port decisions, each one a documented trap in the README:

   - A tunnel is an open shape and reads as a portal, not an orb — and a
     prism bounded inside a ball reads as an object in a jar. So the ORB IS
     THE OBJECT: the square tube becomes a sphere-radius shell evaluated on
     the turbulence-warped point, which makes the ball's own surface the
     thing that disperses. Rays grazing the limb ride the shell for a long
     arc — many small-d, high-weight steps — so the rim glows the way glass
     does, for free. The README's closed-shell trap (accumulation on a shell
     is uniform) does not bite because the detail comes from the warped
     sheet field, not from the accumulation itself.
   - The silhouette is cut ANALYTICALLY in main() from each ray's closest
     approach to the sphere, so the edge is exact and tunably sharp rather
     than a fuzzy envelope fade.
   - The golfed listing relies on i, z, d, s starting at zero. Uninitialised
     locals are UNDEFINED in GLSL ES 1.0 — everything is explicit below.
   - The clock only ever enters as an ADDITIVE PHASE (inside sin/cos), never
     scaling a per-step quantity, so the unbounded integrated clock is safe
     here — no per-step degeneration to fix, unlike the sweep-angle bug this
     repo hit before.
   - The prism is oriented with real orthonormal rotations: a static tilt and
     a spin driven by its own integrated clock, so changing the spin rate
     never jumps the phase. No golfed cos-phase "rotation" matrices — those
     breathe scale and squash the silhouette.
---------------------------------------------------------------------------- */

/*
 * Step counts are `#define`s: ES 1.0 requires constant loop bounds.
 * TURB is 5 to match the original's five octaves (d = 3..7).
 */
const DISPERSION_FRAG = `
#define STEPS 60
#define TURB 5
#define AA 1

// Volume-reactive values, resolved once per fragment in main().
float dispersionTurb;
float dispersionExposure;

mat2 rot2(float a) {
  float c = cos(a);
  float s = sin(a);
  return mat2(c, -s, s, c);
}

vec3 dispersionRender(vec2 fragCoord) {
  float animTime = uP_speed; // integrated clock: turbulence + sheet drift
  float spinAng = uP_spin;   // integrated clock: prism precession

  vec2 uv = (2.0 * fragCoord - uRes) / min(uRes.x, uRes.y);
  vec3 ro = vec3(0.0, 0.0, uP_camDist);
  vec3 rd = normalize(vec3(uv, -uP_focal));

  vec3 acc = vec3(0.0);

  // transmittance carried front-to-back, as in shdr-21 and the README's
  // diffusion note — near sheets veil far ones, which is where the depth
  // read comes from
  float T = 1.0;

  /*
    March only the span that can contribute. The tube is infinite, so a ray
    grazing its wall far in FRONT of the ball would otherwise stall there —
    small d, step after step — and exhaust STEPS before ever reaching the
    envelope, leaving a dark notch across the orb. Start at the envelope's
    near edge and break past its far edge; all 60 steps land where the
    envelope is non-zero.
  */
  float z = max(uP_camDist - uP_envRadius * 1.3, 0.0);
  float zEnd = uP_camDist + uP_envRadius * 1.3;

  for (int it = 0; it < STEPS; it++) {
    vec3 p = ro + rd * z;

    // orient the prism: static tilt about x, then precession about y from
    // the spin clock. Real rotations — see the header note.
    vec3 q = p;
    q.xz = rot2(spinAng) * q.xz;
    q.yz = rot2(uP_tilt) * q.yz;

    // turbulence in the prism's rotating frame; the +float(it) offset is the
    // original's +i, decorrelating octaves per step for a smoky depth
    vec3 a = q;
    for (int j = 0; j < TURB; j++) {
      float dj = float(j) + 3.0;
      a -= dispersionTurb * sin(a * dj + animTime + float(it)).yzx / dj;
    }

    /*
      The orb's own shell, in place of the original's square tube
      (golfed there as max(p=abs(p),p.y).x — just max(|x|,|y|)). Evaluated
      on the WARPED point, so the turbulence shimmers the surface itself
      like an oil film; at turb 0 it is a perfect glass shell. The cos
      sheets fill the interior with the dispersive volume.
    */
    float wall = abs(length(a) - uP_envRadius);
    float s = a.z + a.y - animTime;
    float d = max(wall + abs(cos(s)) / uP_sheets, 1e-4);

    /*
      Per-channel palette: one cosine phase per channel, scaled by uP_disperse
      (0 collapses to monochrome breathing, 1 is the original rainbow). The
      -z term couples depth into the phase, which is what turns the sheets
      into striations; uP_stria scales it.

      The CLAMP is load-bearing, same as the other accumulators here: 1/d
      spikes where a ray grazes the wall exactly where a sheet sits, and one
      unclamped sample would own the whole 60-step sum at some phases.
    */
    vec3 w = (cos(s - z * uP_stria + vec3(0.0, 1.0, 8.0) * uP_disperse) + 1.0) / d;
    w = min(w, vec3(uP_stepClamp));

    /*
      Envelope: bounds the sheet glow (the cos field lives EVERYWHERE in
      space, not just inside the ball) and adds the uP_fill floor that
      guarantees a body. The outer bound sits 12% PAST the radius on
      purpose: the shell IS the radius now, the silhouette is cut
      analytically in main(), and a hard cut only reads as a sharp edge if
      there is still emission left at the boundary to cut. envCore is where
      the plateau saturates — 1 keeps the shell at full strength, lower
      values pull the brightness into the core.
    */
    float env = smoothstep(uP_envRadius * 1.12, uP_envRadius * uP_envCore, length(p));
    w = (w + uP_fill) * env;

    acc += T * w;
    T *= exp(-dot(w, vec3(0.299, 0.587, 0.114)) * uP_scatter);

    z += d;
    if (T < 0.004 || z > zEnd) break;
  }

  return acc;
}

vec3 dispersionAt(vec2 fc) {
  vec3 acc = vec3(0.0);
#if AA > 1
  for (int mx = 0; mx < AA; mx++) {
    for (int my = 0; my < AA; my++) {
      vec2 offset = vec2(float(mx), float(my)) / float(AA) - 0.5;
      acc += dispersionRender(fc + offset);
    }
  }
  acc /= float(AA * AA);
#else
  acc = dispersionRender(fc);
#endif
  return acc;
}

// The rim point below uv, turned by ang about the centre.
vec2 edgeTap(vec2 uv, float R, float ang) {
  vec2 q = orbRimUV(uv, R);
  float c = cos(ang);
  float s = sin(ang);
  return vec2(q.x * c - q.y * s, q.x * s + q.y * c);
}

void main() {
  dispersionTurb = uP_turb * (1.0 + 0.5 * uInput);
  dispersionExposure = uP_exposure * (1.0 - 0.35 * uOutput);

  /*
    Organic edge. The silhouette used to be an exact analytic cut, which is
    what read as a circle stamp. The shell radius in world units projects to
    a screen radius R (closest approach == envRadius, solved for the pixel),
    and the cut is now orbOrganicMask on that R: the rim wanders and
    feathers. Pixels past the true limb sample the ray that grazes the limb
    just below them, so the lumps and the bleed carry the shell's real
    glowing edge colour rather than black. A rim sample is constant along
    the radius, so the shell's fine striations would smear into radial
    spikes: out there the colour is averaged over rim taps whose angular
    spread widens with distance, blurring it into soft wisps.
  */
  vec2 uv = orbUV();
  float R = uP_focal * uP_envRadius / sqrt(max(uP_camDist * uP_camDist - uP_envRadius * uP_envRadius, 1e-4));

  vec3 acc = dispersionAt(orbFragCoord(orbRimUV(uv, R)));
  float spread = 2.5 * max(length(uv) - 0.96 * R, 0.0) / R;
  if (spread > 0.0) {
    acc = acc * 0.4 + 0.3 * (dispersionAt(orbFragCoord(edgeTap(uv, R, spread)))
                           + dispersionAt(orbFragCoord(edgeTap(uv, R, -spread))));
  }

  // tanh tone map, as in the original but per channel and with a tunable
  // knee — the envelope and transmittance change the accumulator's scale
  // completely, so the golfed /2e2 constant means nothing here
  vec3 col = tanh3(acc / max(dispersionExposure, 1.0));
  col = pow(clamp(col, 0.0, 1.0), vec3(uP_contrast));

  // saturation about luminance, then the tint
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(lum), col, uP_saturation);
  col *= uC_tint;

  // alpha from the brightest channel, not luminance — a saturated violet
  // fringe has low luminance but must not go transparent
  float peak = max(col.r, max(col.g, col.b));
  float a = clamp(peak * uP_alphaGain, 0.0, 1.0);

  /*
    uP_edge still trades the transition band: 1 leaves only the rim feather,
    0 falls back to the old wide soft fade. Colour AND alpha, as always.
  */
  float soft = uP_edgeSoft + (1.0 - clamp(uP_edge, 0.0, 1.0)) * 0.175;
  float mask = orbOrganicMask(uv, R, uP_organic, soft, uP_edgeFlow);

  // Energy creeping off the shell in tendrils, in the rim's own dispersed
  // colour; it swells with the agent's voice.
  float bleed = orbBleed(uv, R, uP_reach, uP_edgeFlow) * uP_bleed * (0.7 + 0.6 * uOutput);
  vec3 glow = col * (0.6 + 0.4 * a) * bleed * (1.0 - mask);
  float glowA = clamp(max(glow.r, max(glow.g, glow.b)), 0.0, 1.0);

  col = col * mask + glow;
  a = max(a * mask, glowA);

  // Fade colour as well as alpha — with premultiplied output, fading only
  // alpha leaves the pixel emitting at full brightness up to the cutoff,
  // which reads as a hard rim. Only a safety taper at the frame boundary.
  float fade = 1.0 - smoothstep(uP_edgeFade, 1.0, length(uv));
  col *= fade;
  a *= fade;

  // Emitted light, so rgb is already premultiplied — do NOT scale by alpha
  // again (see the same note in shdr-31).
  gl_FragColor = vec4(col, a);
}
`;

export const shdr01Orb: OrbVariant = {
  key: "shdr-01",
  label: "SHDR-01",
  note: "cut-glass orb with a dispersive, turbulent interior",
  frag: DISPERSION_FRAG,
  params: [
    { key: "speed", label: "Anim speed", min: 0.015, max: 10, step: 0.05, default: 0.5, integrate: true },
    { key: "spin", label: "Spin rate", min: 0, max: 5, step: 0.03, default: 0.25, integrate: true },
    { key: "camDist", label: "Camera distance", min: 1, max: 50, step: 0.3, default: 7 },
    { key: "focal", label: "Lens", min: 0.15, max: 15, step: 0.05, default: 2 },
    { key: "tilt", label: "Field tilt", min: 0, max: 4, step: 0.02, default: 0.5 },
    { key: "turb", label: "Turbulence", min: 0, max: 5, step: 0.03, default: 0.3 },
    { key: "sheets", label: "Sheet density", min: 1, max: 60, step: 0.5, default: 7 },
    { key: "disperse", label: "Dispersion", min: 0, max: 5, step: 0.03, default: 1 },
    { key: "stria", label: "Striation depth", min: 0, max: 10, step: 0.05, default: 1 },
    { key: "envRadius", label: "Envelope radius", min: 0.15, max: 15, step: 0.1, default: 2.6 },
    { key: "envCore", label: "Envelope core", min: 0.3, max: 1.02, step: 0.01, default: 1 },
    { key: "fill", label: "Body fill", min: 0, max: 100, step: 0.3, default: 1.5 },
    { key: "stepClamp", label: "Step clamp", min: 0.3, max: 300, step: 1.5, default: 20 },
    { key: "scatter", label: "Diffusion", min: 0, max: 0.5, step: 0.003, default: 0.02 },
    { key: "exposure", label: "Exposure", min: 1.5, max: 1500, step: 10, default: 60 },
    { key: "contrast", label: "Contrast", min: 0.15, max: 15, step: 0.1, default: 1 },
    { key: "saturation", label: "Saturation", min: 0, max: 4, step: 0.02, default: 1 },
    { key: "alphaGain", label: "Alpha gain", min: 0.05, max: 15, step: 0.1, default: 2 },
    { key: "edge", label: "Edge sharpness", min: 0, max: 1, step: 0.01, default: 1 },
    { key: "edgeFade", label: "Halo falloff", min: 0.1, max: 3, step: 0.015, default: 0.98 },
    { key: "organic", label: "Rim wander", min: 0, max: 0.15, step: 0.005, default: 0.04 },
    { key: "edgeSoft", label: "Rim feather", min: 0, max: 0.2, step: 0.005, default: 0.035 },
    { key: "bleed", label: "Energy bleed", min: 0, max: 3, step: 0.01, default: 0.9 },
    { key: "reach", label: "Bleed reach", min: 0.02, max: 0.5, step: 0.005, default: 0.1 },
    { key: "edgeFlow", label: "Edge flow", min: 0, max: 3, step: 0.01, default: 0.35, integrate: true }
  ],
  colors: [{ key: "tint", label: "Tint", default: "#ffffff" }],
  statePresets: {
    idle: {
      speed: 0.5,
      spin: 0.25,
      turb: 0.3,
      disperse: 1,
      sheets: 7,
      exposure: 60,
      scatter: 0.02,
      alphaGain: 2,
      organic: 0.03,
      bleed: 0.7,
      reach: 0.08,
      edgeFlow: 0.3
    },
    thinking: {
      speed: 0.6,
      spin: 0.5,
      turb: 0.35,
      disperse: 1.1,
      sheets: 7,
      exposure: 57,
      scatter: 0.019,
      alphaGain: 2.1,
      organic: 0.045,
      bleed: 0.9,
      reach: 0.1,
      edgeFlow: 0.75
    },
    // loudest: fast drift, dense sheets, wide rainbow
    speaking: {
      speed: 1.2,
      spin: 0.7,
      turb: 0.55,
      disperse: 1.5,
      sheets: 5.5,
      exposure: 45,
      scatter: 0.015,
      alphaGain: 2.5,
      organic: 0.06,
      bleed: 1.3,
      reach: 0.13,
      edgeFlow: 1.1
    }
  }
};

export type Shdr01Props = Omit<ShaderOrbProps, "variant">;

export function Shdr01({ size = 280, ...rest }: Shdr01Props) {
  return <ShaderOrb variant={shdr01Orb} size={size} {...rest} />;
}

export default Shdr01;
