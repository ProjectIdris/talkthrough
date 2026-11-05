import { Quaternion, Vector3 } from 'three';

type V3 = readonly [number, number, number];
export type FlexSection = { u: number; center: V3; chord: V3; halfWidth: number; camber: number; profileDelta: number };
export type FlexFrame = { center: Vector3; chord: Vector3; tangent: Vector3; normal: Vector3; halfWidth: number; camber: number; profileDelta: number };

/** Interpolate the section fields, then build the specified transported frames. */
export function sampleFrames(sections: readonly FlexSection[]): FlexFrame[] {
  if (sections.length < 3 || sections.length > 8 || sections[0]?.u !== 0 || sections.at(-1)?.u !== 1) throw Error('invalid sections');
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i]!;
    if (![s.u, ...s.center, ...s.chord, s.halfWidth, s.camber, s.profileDelta].every(Number.isFinite)
      || s.halfWidth < .05 || s.halfWidth > 10 || Math.abs(s.camber) > s.halfWidth / 2 || Math.abs(s.profileDelta) > s.halfWidth / 2
      || (i > 0 && (s.u <= sections[i - 1]!.u || new Vector3(...s.center).distanceTo(new Vector3(...sections[i - 1]!.center)) < .05))) throw Error('invalid section');
  }
  const rows = Array.from({ length: 25 }, (_, i) => {
    const u = i / 24;
    let k = 0;
    while (k < sections.length - 2 && u > sections[k + 1]!.u) k++;
    const a = sections[k]!, b = sections[k + 1]!, f = (u - a.u) / (b.u - a.u);
    return { center: new Vector3(...a.center).lerp(new Vector3(...b.center), f),
      authored: new Vector3(...a.chord).lerp(new Vector3(...b.chord), f),
      halfWidth: a.halfWidth + f * (b.halfWidth - a.halfWidth),
      camber: a.camber + f * (b.camber - a.camber), profileDelta: a.profileDelta + f * (b.profileDelta - a.profileDelta) };
  });
  const frames: FlexFrame[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const tangent = rows[Math.min(24, i + 1)]!.center.clone().sub(rows[Math.max(0, i - 1)]!.center);
    if (tangent.lengthSq() < 1e-16) throw Error('degenerate tangent');
    tangent.normalize();
    const prior = frames[i - 1];
    if (prior && prior.tangent.dot(tangent) < .5) throw Error('tangent reversal');
    const chord = row.authored.clone().addScaledVector(tangent, -row.authored.dot(tangent));
    if (chord.length() < .1 * row.authored.length() || chord.lengthSq() < 1e-16) throw Error('degenerate chord');
    chord.normalize();
    if (prior) {
      const transported = prior.chord.clone().applyQuaternion(new Quaternion().setFromUnitVectors(prior.tangent, tangent));
      const angle = Math.atan2(new Vector3().crossVectors(transported, chord).dot(tangent), transported.dot(chord));
      if (Math.abs(angle) > Math.PI / 4 + 1e-12) throw Error('frame twist');
      chord.copy(transported).applyAxisAngle(tangent, angle).normalize();
    }
    frames.push({ center: row.center, tangent, chord, normal: new Vector3().crossVectors(chord, tangent).normalize(), halfWidth: row.halfWidth, camber: row.camber, profileDelta: row.profileDelta });
  }
  return frames;
}

