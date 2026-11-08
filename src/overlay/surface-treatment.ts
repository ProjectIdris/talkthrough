// Optional appearance layered over the named physical material. The scene can
// select a fixed preset, never supply shader code, texture URLs or extra strands.
import { BufferAttribute } from 'three';
import type { BufferGeometry, Material } from 'three';
import type { PathTreatment } from '../scene/types.ts';
import { materialRow } from '../scene/material-library.ts';

/**
 * The surface layer an object wears: the one the scene asks for with `treatment`, else the one its material carries (the library: muscle, tendon and rope
 * have fibres). This is where a layer plugs in: a new name in PathTreatment, its row in the library, its coordinates and its shader below.
 */
export function treatmentOf(def: object): PathTreatment | undefined {
  const d = def as { treatment?: PathTreatment; material?: string };
  return d.treatment ?? materialRow(d.material)?.treatment;
}

/** Coordinates on the existing swept rings, not a projection through world space.
 * This topology is shared by open/closed tubes and rebuilt connectors. Untreated
 * geometry allocates nothing; position, normal, index and draw range stay intact. */
export function setPathSurfaceCoordinates(geometry: BufferGeometry, treatment: PathTreatment | undefined): void {
  if (treatment !== 'fibres' || geometry.hasAttribute('surfaceCoord')) return;
  const rings = geometry.userData.rings as number;
  const radial = geometry.userData.indicesPerRing / 6;
  const row = radial + 1;
  const count = geometry.getAttribute('position').count;
  const capRings = geometry.userData.startCap / (radial * 6);
  const stability = (geometry.userData.surfaceFrameStability as number | undefined) ?? 1;
  const coordinates = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const ring = Math.floor(i / row);
    const cap = ring >= rings;
    const capRing = cap ? (ring - rings) % capRings + 1 : 0;
    coordinates[i * 3] = (i % row) / radial;
    coordinates[i * 3 + 1] = cap ? (ring < rings + capRings ? 0 : 1) : ring / Math.max(1, rings - 1);
    // Fade smoothly to zero at the cap poles, where longitude is undefined.
    coordinates[i * 3 + 2] = stability * (cap ? Math.cos(capRing / capRings * Math.PI / 2) ** 2 : 1);
  }
  geometry.setAttribute('surfaceCoord', new BufferAttribute(coordinates, 3));
}

// Even harmonics also make the effect invariant to a 180-degree frame sign.
// Only two fixed harmonics: no texture lookup, loops, time or random state. A
// conservative derivative low-pass fades unresolved fibres to the base material
// rather than letting narrow stripes alias. Take derivatives before any discard.
const FIBRE_FILTER = `
float filteredFibreWave(float phase, float footprint) {
  float resolved = 1.0 - smoothstep(0.25, 0.75, footprint);
  return cos(6.28318530718 * fract(phase)) * resolved;
}
`;

export function applyPathTreatment(material: Material, treatment: PathTreatment | undefined): void {
  if (treatment !== 'fibres') return;
  const previous = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey();
  material.onBeforeCompile = function (shader, renderer) {
    previous.call(this, shader, renderer);
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'attribute vec3 surfaceCoord;\nvarying vec3 vSurfaceCoord;\nvoid main() {\n  vSurfaceCoord = surfaceCoord;');
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', `varying vec3 vSurfaceCoord;\n${FIBRE_FILTER}\nvoid main() {\n  float fibrePhase = vSurfaceCoord.x * 28.0;\n  float fibreFinePhase = vSurfaceCoord.x * 44.0;\n  float fibreWave = vSurfaceCoord.z * (0.7 * filteredFibreWave(fibrePhase, fwidth(fibrePhase))\n    + 0.3 * filteredFibreWave(fibreFinePhase, fwidth(fibreFinePhase)));`)
      .replace('#include <color_fragment>', '#include <color_fragment>\n  diffuseColor.rgb *= 1.0 + 0.12 * fibreWave;')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  roughnessFactor = clamp(roughnessFactor - 0.07 * fibreWave, 0.0, 1.0);');
  };
  material.customProgramCacheKey = () => `${previousKey}|path-fibres-v1`;
}
