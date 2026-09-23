"use client";

import { useState } from "react";
import { ORB_STATES, type OrbState } from "@/components/ui/orbkit-core";
import { ORBS, type OrbEntry } from "@/lib/orbs";

function StateSwitch({
  value,
  onChange,
  label
}: {
  value: OrbState | null;
  onChange: (state: OrbState) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-full border border-border p-0.5 text-xs">
      {ORB_STATES.map((s) => (
        <button
          key={s}
          type="button"
          role="radio"
          aria-checked={value === s}
          onClick={() => onChange(s)}
          className={`rounded-full px-3 py-1 capitalize transition-colors ${
            value === s ? "bg-foreground text-background" : "text-muted hover:text-foreground"
          }`}
        >
          {s}
        </button>
      ))}
    </div>
  );
}

function OrbCard({
  orb,
  state,
  onStateChange
}: {
  orb: OrbEntry;
  state: OrbState;
  onStateChange: (state: OrbState) => void;
}) {
  const { Component } = orb;
  return (
    <article className="flex flex-col items-center gap-4 rounded-2xl border border-border bg-card p-5">
      <div className="flex w-full items-baseline justify-between">
        <h2 className="text-sm font-medium">{orb.title}</h2>
        <code className="text-[11px] text-muted">{orb.slug}</code>
      </div>
      <Component size={220} state={state} ariaLabel={`${orb.title} orb, ${state}`} />
      <p className="min-h-10 text-center text-xs leading-relaxed text-muted">{orb.variant.note}</p>
      <StateSwitch value={state} onChange={onStateChange} label={`${orb.title} state`} />
      {orb.credit ? <p className="text-[10px] text-muted">{orb.credit}</p> : null}
    </article>
  );
}

export default function Home() {
  // Each orb keeps its own state; "Set all" just writes the same value into every slot.
  const [states, setStates] = useState<Record<string, OrbState>>(() =>
    Object.fromEntries(ORBS.map((o) => [o.slug, "idle" as OrbState]))
  );
  const allSame = new Set(Object.values(states)).size === 1 ? Object.values(states)[0] : null;

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6">
      <header className="mb-10 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Orbsy</h1>
          <p className="mt-1 max-w-xl text-sm text-muted">
            Orbkit&apos;s Dispersion orb plus ten new ones. Every orb has its own idle, thinking and
            speaking look, and each card switches state independently.
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted">
          Set all
          <StateSwitch
            value={allSame}
            label="Set every orb's state"
            onChange={(s) => setStates(Object.fromEntries(ORBS.map((o) => [o.slug, s])))}
          />
        </div>
      </header>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {ORBS.map((orb) => (
          <OrbCard
            key={orb.slug}
            orb={orb}
            state={states[orb.slug]}
            onStateChange={(s) => setStates((prev) => ({ ...prev, [orb.slug]: s }))}
          />
        ))}
      </section>
    </main>
  );
}
