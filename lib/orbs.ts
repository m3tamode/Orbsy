import type { OrbVariant, ShaderOrbProps } from "@/components/ui/orbkit-core";
import { Shdr01, shdr01Orb } from "@/components/ui/shdr-01";
import { Orbsy01, orbsy01Orb } from "@/components/ui/orbsy-01";
import { Orbsy02, orbsy02Orb } from "@/components/ui/orbsy-02";
import { Orbsy03, orbsy03Orb } from "@/components/ui/orbsy-03";
import { Orbsy04, orbsy04Orb } from "@/components/ui/orbsy-04";
import { Orbsy05, orbsy05Orb } from "@/components/ui/orbsy-05";
import { Orbsy06, orbsy06Orb } from "@/components/ui/orbsy-06";
import { Orbsy07, orbsy07Orb } from "@/components/ui/orbsy-07";
import { Orbsy08, orbsy08Orb } from "@/components/ui/orbsy-08";
import { Orbsy09, orbsy09Orb } from "@/components/ui/orbsy-09";
import { Orbsy10, orbsy10Orb } from "@/components/ui/orbsy-10";

export interface OrbEntry {
  slug: string;
  title: string;
  variant: OrbVariant;
  Component: (props: Omit<ShaderOrbProps, "variant">) => React.JSX.Element;
  credit?: string;
}

export const ORBS: OrbEntry[] = [
  {
    slug: "shdr-01",
    title: "Dispersion",
    variant: shdr01Orb,
    Component: Shdr01,
    credit: "Orbkit port of a shader by XorDev, non-commercial use only"
  },
  { slug: "orbsy-01", title: "Halftone", variant: orbsy01Orb, Component: Orbsy01 },
  { slug: "orbsy-02", title: "Chrome", variant: orbsy02Orb, Component: Orbsy02 },
  { slug: "orbsy-03", title: "Aurora", variant: orbsy03Orb, Component: Orbsy03 },
  { slug: "orbsy-04", title: "Contour", variant: orbsy04Orb, Component: Orbsy04 },
  { slug: "orbsy-05", title: "Pixel", variant: orbsy05Orb, Component: Orbsy05 },
  { slug: "orbsy-06", title: "Iris", variant: orbsy06Orb, Component: Orbsy06 },
  { slug: "orbsy-07", title: "Waveform", variant: orbsy07Orb, Component: Orbsy07 },
  { slug: "orbsy-08", title: "Nebula", variant: orbsy08Orb, Component: Orbsy08 },
  { slug: "orbsy-09", title: "Lattice", variant: orbsy09Orb, Component: Orbsy09 },
  { slug: "orbsy-10", title: "Bubble", variant: orbsy10Orb, Component: Orbsy10 }
];
