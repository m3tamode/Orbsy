// Static checks over every orb, mirroring Orbkit's check:orbs:
// BACKTICK in GLSL, MISSING / UNUSED uniforms, STALE preset keys.
import { readFileSync, readdirSync } from "node:fs";

const dir = new URL("../components/ui/", import.meta.url);
const shared = readFileSync(new URL("orbsy-glsl.ts", dir), "utf8");
let failures = 0;
const fail = (file, kind, msg) => {
  failures++;
  console.error(`${file}: ${kind} ${msg}`);
};

for (const file of readdirSync(dir).filter((f) => /^(orbsy|shdr)-\d+\.tsx$/.test(f))) {
  const src = readFileSync(new URL(file, dir), "utf8");
  const frags = [...src.matchAll(/=\s*(?:ORBSY_GLSL\s*\+\s*)?`([\s\S]*?)`;/g)].map((m) => m[1]);
  const glsl = frags.join("\n") + (src.includes("ORBSY_GLSL") ? shared : "");
  const paramKeys = [...src.matchAll(/\{\s*key:\s*"(\w+)",\s*label:[^}]*min:/g)].map((m) => m[1]);
  const colorsBlock = src.match(/colors:\s*\[([\s\S]*?)\]/)?.[1] ?? "";
  const colorKeys = [...colorsBlock.matchAll(/key:\s*"(\w+)"/g)].map((m) => m[1]);
  const usedP = new Set([...glsl.matchAll(/uP_(\w+)/g)].map((m) => m[1]));
  const usedC = new Set([...glsl.matchAll(/uC_(\w+)/g)].map((m) => m[1]));
  for (const k of usedP) if (!paramKeys.includes(k)) fail(file, "MISSING", `uP_${k}`);
  for (const k of usedC) if (!colorKeys.includes(k)) fail(file, "MISSING", `uC_${k}`);
  for (const k of paramKeys) if (!usedP.has(k)) fail(file, "UNUSED", `param ${k}`);
  for (const k of colorKeys) if (!usedC.has(k)) fail(file, "UNUSED", `color ${k}`);
  const presets = src.match(/statePresets:\s*\{([\s\S]*?)\n  \}/)?.[1] ?? "";
  for (const m of presets.matchAll(/(\w+):\s*[-\d.]+/g)) if (!paramKeys.includes(m[1])) fail(file, "STALE", `preset ${m[1]}`);
  const sc = src.match(/stateColors:\s*\{([\s\S]*?)\n  \}/)?.[1] ?? "";
  for (const m of sc.matchAll(/(\w+):\s*"#/g)) if (!colorKeys.includes(m[1])) fail(file, "STALE", `stateColor ${m[1]}`);
  console.log(`${file}: ${paramKeys.length} params, ${colorKeys.length} colours`);
}
if (failures) process.exit(1);
