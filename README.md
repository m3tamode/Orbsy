# Orbsy

WebGL shader orbs for agent UIs, built on [Orbkit](https://github.com/zzzzshawn/orbkit).

- `components/ui/orbkit-core.tsx` and `components/ui/shdr-01.tsx` come from
  `npx shadcn@latest add zzzzshawn/orbkit/shdr-01`.
- `components/ui/orbsy-01.tsx` to `orbsy-10.tsx` are ten new orbs on the same runtime, sharing
  some GLSL helpers in `components/ui/orbsy-glsl.ts`.

Every orb has three states: `idle`, `thinking` and `speaking`. Each state has its own parameter
preset (`statePresets`) and its own palette (`stateColors`), and switching states cross-fades
between them.

| Slug | Name | Look |
| --- | --- | --- |
| `shdr-01` | Dispersion | Orbkit's cut-glass orb with a dispersive, turbulent interior |
| `orbsy-01` | Halftone | A lit, noise-streaked sphere printed through a rotated dot screen |
| `orbsy-02` | Chrome | A liquid-metal blob reflecting a procedural studio, with oily iridescence |
| `orbsy-03` | Aurora | Three liquid colour blobs orbiting inside a glassy voice-assistant orb |
| `orbsy-04` | Contour | Topographic isolines on a slowly turning globe |
| `orbsy-05` | Pixel | A four-colour low-res sprite of a sphere with slipping glitch rows |
| `orbsy-06` | Iris | A fibrous iris whose pupil dilates and glows with the agent's voice |
| `orbsy-07` | Waveform | Stacked pulsar-plot signal traces that bulge when the agent speaks |
| `orbsy-08` | Nebula | Domain-warped gas and twinkling stars in a glowing pocket galaxy |
| `orbsy-09` | Lattice | An evenly spaced particle globe with energy rippling across its dots |
| `orbsy-10` | Bubble | A soap bubble with swirling thin-film interference |

## Usage

```tsx
import { Orbsy03 } from "@/components/ui/orbsy-03";

<Orbsy03 size={280} state={isSpeaking ? "speaking" : isBusy ? "thinking" : "idle"} />;

// override any param or colour, or retune a single state
<Orbsy03 state="thinking" statePresets={{ thinking: { orbit: 1.6 } }} colors={{ c1: "#00ffaa" }} />;
```

## Development

```bash
npm install
npm run dev        # gallery at http://localhost:3000, one state switch per orb
npm run check:orbs # static checks: backticks, missing/unused uniforms, stale presets
npm run build      # check:orbs, then next build
```

## Licensing

- `orbkit-core.tsx` and the `orbsy-*` orbs are MIT.
- `shdr-01.tsx` is ported from a shader by [@XorDev](https://x.com/XorDev): **non-commercial use
  only, with attribution**. Keep its header notice, and don't ship it in a commercial product
  without clearing it with the author.
