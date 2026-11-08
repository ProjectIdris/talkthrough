// The lighting every surface is reflected in and lit by: a small photographic studio built in code (no image file, no licence, nothing to
// fetch). A soft gradient dome stands for the room, and rectangles brighter than anything on screen stand for softboxes, a strip light and an
// overhead panel. Pre-filtered once (PMREMGenerator.fromScene), it gives a metal curve a soft bright band with a darker gap beside it and a
// glossy plastic a clean window highlight, which a plain room of evenly lit walls cannot: the reflections are what make a surface read as made of
// something. Brightness is in linear values above one (the target is half-float); the renderer's tone mapping brings them back.

import { BackSide, Color, DoubleSide, Float32BufferAttribute, Mesh, MeshBasicMaterial, PlaneGeometry, Scene, SphereGeometry, Vector3 } from 'three';

type Light = {
  /** Where its middle is, in the studio's own units (the model sits at the origin, the camera looks along -z). */
  at: [number, number, number];
  /** Width and height of the lit rectangle. */
  size: [number, number];
  /** Linear colour; its brightest channel is the light's strength. */
  color: [number, number, number];
  /** Turn about its own long axis, in degrees (a strip light stands up or lies down). */
  roll?: number;
};

/** The studio's lamps: one large key to the upper left, a cooler fill on the right, a strip behind for a rim along an edge, a panel overhead, a low warm bounce. */
export const STUDIO_LIGHTS: readonly Light[] = [
  { at: [-9, 8, 9], size: [9, 7], color: [7, 6.6, 6] },
  { at: [12, 3.5, 7], size: [8, 9], color: [1.6, 1.9, 2.3] },
  { at: [-3, 7, -13], size: [18, 1.6], color: [5, 5, 5] },
  { at: [-13, 2, -3], size: [1.4, 11], color: [3.2, 3.2, 3.4] },
  { at: [0, 17, 0], size: [14, 14], color: [1.2, 1.2, 1.25] },
  { at: [0, -9, 5], size: [18, 8], color: [0.5, 0.45, 0.4] },
];

/** The dome's colours by height: a light cool sky above, a mid grey at the horizon, a dark warm floor below. */
const DOME = { zenith: [0.85, 0.87, 0.9], horizon: [0.5, 0.5, 0.5], nadir: [0.14, 0.13, 0.12] } as const;

export class StudioEnvironment extends Scene {
  constructor() {
    super();
    this.name = 'StudioEnvironment';

    const dome = new SphereGeometry(40, 48, 24);
    const pos = dome.getAttribute('position');
    const colours: number[] = [];
    const c = new Color();
    for (let i = 0; i < pos.count; i++) {
      const up = pos.getY(i) / 40;
      const a = up >= 0 ? DOME.horizon : DOME.nadir;
      const b = up >= 0 ? DOME.zenith : DOME.horizon;
      const t = up >= 0 ? Math.pow(up, 0.7) : 1 - Math.pow(-up, 0.7);
      c.setRGB(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t);
      colours.push(c.r, c.g, c.b);
    }
    dome.setAttribute('color', new Float32BufferAttribute(colours, 3));
    this.add(new Mesh(dome, new MeshBasicMaterial({ vertexColors: true, side: BackSide, toneMapped: false })));

    const panel = new PlaneGeometry(1, 1);
    for (const light of STUDIO_LIGHTS) {
      const material = new MeshBasicMaterial({ color: new Color(light.color[0], light.color[1], light.color[2]), side: DoubleSide, toneMapped: false });
      const mesh = new Mesh(panel, material);
      mesh.scale.set(light.size[0], light.size[1], 1);
      mesh.position.set(...light.at);
      mesh.lookAt(new Vector3(0, 0, 0));
      if (light.roll) mesh.rotateZ((light.roll * Math.PI) / 180);
      this.add(mesh);
    }
  }

  /** Releases the geometry and materials once the environment has been filtered. */
  dispose(): void {
    const seen = new Set<unknown>();
    this.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      if (!seen.has(mesh.geometry)) { seen.add(mesh.geometry); mesh.geometry.dispose(); }
      (mesh.material as MeshBasicMaterial).dispose();
    });
  }
}
