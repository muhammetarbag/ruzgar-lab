import * as THREE from "three";
export interface ModelSpec {
  id: string;
  name: string;
  subtitle: string;
  cd: number;
  length: number;
  build: () => THREE.Group;
}
const paint = (color: string, metalness = 0.1) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.42, metalness });
const blue = paint("#527c95", 0.5),
  red = paint("#cb5c43", 0.4),
  white = paint("#e8e7dd");
const dark = paint("#283640"),
  glass = paint("#416171", 0.7),
  chrome = paint("#d1dbe0", 0.85);
function part(
  group: THREE.Group,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  p: number[],
  scale?: number[],
) {
  const mesh = new THREE.Mesh(geometry, material.clone());
  mesh.position.set(p[0], p[1], p[2]);
  if (scale) mesh.scale.set(scale[0], scale[1], scale[2]);
  mesh.castShadow = mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}
const box = (g: THREE.Group, d: number[], p: number[], m: THREE.Material) =>
  part(g, new THREE.BoxGeometry(...(d as [number, number, number])), m, p);
const ellipsoid = (
  g: THREE.Group,
  s: number[],
  p: number[],
  m: THREE.Material,
) => part(g, new THREE.SphereGeometry(1, 32, 20), m, p, s);
function wing() {
  const g = new THREE.Group();
  const shape = new THREE.Shape();
  const chord = 1.2;
  const thickness = (x: number) =>
    5 *
    0.12 *
    (0.2969 * Math.sqrt(x) -
      0.126 * x -
      0.3516 * x ** 2 +
      0.2843 * x ** 3 -
      0.1036 * x ** 4);
  for (let i = 0; i <= 90; i++) {
    const x = (1 - Math.cos((i / 90) * Math.PI)) / 2;
    if (i === 0) shape.moveTo((x - 0.5) * chord, thickness(x) * chord);
    else shape.lineTo((x - 0.5) * chord, thickness(x) * chord);
  }
  for (let i = 90; i >= 0; i--) {
    const x = (1 - Math.cos((i / 90) * Math.PI)) / 2;
    shape.lineTo((x - 0.5) * chord, -thickness(x) * chord);
  }
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 3.6,
    bevelEnabled: false,
    steps: 1,
  });
  geo.translate(0, 0, -1.8);
  part(g, geo, blue, [0, 0, 0]);
  return g;
}
function cow() {
  const g = new THREE.Group();
  ellipsoid(g, [0.96, 0.55, 0.39], [0.12, 1.03, 0], white);
  ellipsoid(g, [0.32, 0.47, 0.3], [-0.84, 1.13, 0], white);
  ellipsoid(g, [0.37, 0.28, 0.24], [-1.09, 1.22, 0], white);
  ellipsoid(g, [0.18, 0.16, 0.24], [-1.36, 1.15, 0], paint("#c99e95"));
  for (const z of [-0.27, 0.27]) {
    for (const x of [-0.55, 0.72]) {
      const leg = part(
        g,
        new THREE.CylinderGeometry(0.085, 0.065, 0.7, 12),
        white,
        [x, 0.4, z],
      );
      leg.rotation.z = x < 0 ? -0.05 : 0.08;
      box(g, [0.18, 0.14, 0.15], [x - 0.015, 0.07, z], dark);
    }
    ellipsoid(g, [0.19, 0.06, 0.13], [-0.95, 1.49, z * 1.35], white);
    ellipsoid(g, [0.035, 0.035, 0.018], [-1.2, 1.33, z * 0.78], dark);
    const horn = part(g, new THREE.ConeGeometry(0.06, 0.25, 12), chrome, [
      -0.94,
      1.68,
      z * 0.65,
    ]);
    horn.rotation.z = 0.25;
    ellipsoid(g, [0.33, 0.3, 0.03], [0.38, 1.14, z * 1.36], dark);
    ellipsoid(g, [0.2, 0.24, 0.025], [-0.42, 1.18, z * 1.32], dark);
  }
  const tail = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.93, 1.32, 0),
    new THREE.Vector3(1.17, 1.05, 0.06),
    new THREE.Vector3(1.12, 0.58, 0.13),
  ]);
  part(g, new THREE.TubeGeometry(tail, 16, 0.035, 8, false), white, [0, 0, 0]);
  ellipsoid(g, [0.065, 0.12, 0.06], [1.12, 0.54, 0.13], dark);
  return g;
}
function car(van: boolean) {
  const g = new THREE.Group(),
    m = van ? blue : red;
  const length = van ? 4.4 : 4.05,
    width = van ? 1.82 : 1.62;
  box(g, [length - 0.12, 0.38, width], [0, 0.58, 0], m);
  box(g, [length - 0.35, 0.18, width - 0.08], [0, 0.85, 0], m);
  box(g, [1.22, 0.12, width - 0.12], [-1.25, 0.98, 0], m);
  if (van) {
    box(g, [2.5, 0.97, width - 0.06], [0.55, 1.3, 0], m);
    box(g, [1.18, 0.72, width - 0.16], [-0.65, 1.3, 0], glass);
    box(g, [3.37, 0.1, width - 0.06], [0.08, 1.8, 0], m);
    for (const z of [-1, 1]) {
      box(g, [0.06, 0.73, 0.05], [-0.55, 1.35, z * (width / 2 - 0.055)], m);
      box(g, [0.045, 0.9, 0.012], [0.5, 1.27, z * (width / 2 - 0.02)], chrome);
      box(g, [0.21, 0.045, 0.045], [-0.3, 1.01, (z * width) / 2], dark);
      box(g, [0.15, 0.24, 0.055], [length / 2 - 0.12, 1.13, z * 0.76], red);
    }
  } else {
    box(g, [1.5, 0.09, width - 0.25], [0.05, 0.96, 0], dark);
    for (const z of [-0.4, 0.4]) {
      box(g, [0.42, 0.15, 0.46], [0.22, 1.02, z], dark);
      const seat = box(g, [0.13, 0.42, 0.46], [0.43, 1.19, z], dark);
      seat.rotation.z = -0.13;
      box(
        g,
        [1.44, 0.18, 0.13],
        [0.03, 1.01, z < 0 ? -width / 2 + 0.04 : width / 2 - 0.04],
        m,
      );
    }
    const windshield = box(
      g,
      [0.055, 0.49, width - 0.26],
      [-0.62, 1.25, 0],
      glass,
    );
    windshield.rotation.z = 0.3;
    box(g, [0.07, 0.045, width - 0.17], [-0.69, 1.49, 0], chrome);
    box(g, [0.87, 0.15, width - 0.07], [1.35, 0.99, 0], m);
  }
  for (const z of [-1, 1]) {
    for (const x of [-1.32, 1.29]) {
      const wheel = part(
        g,
        new THREE.CylinderGeometry(0.34, 0.34, 0.22, 32),
        dark,
        [x, 0.34, z * (width / 2 - 0.04)],
      );
      wheel.rotation.x = Math.PI / 2;
      const rim = part(
        g,
        new THREE.CylinderGeometry(0.21, 0.21, 0.225, 16),
        chrome,
        [x, 0.34, z * (width / 2 - 0.04)],
      );
      rim.rotation.x = Math.PI / 2;
    }
    if (van) box(g, [0.1, 0.19, 0.35], [-length / 2, 0.87, z * 0.61], white);
    else {
      const headlight = part(
        g,
        new THREE.CylinderGeometry(0.115, 0.115, 0.08, 24),
        white,
        [-length / 2, 0.77, z * 0.56],
      );
      headlight.rotation.z = Math.PI / 2;
    }
    box(
      g,
      [0.19, 0.11, 0.16],
      [-0.63, van ? 1.27 : 1.12, z * (width / 2 + 0.07)],
      m,
    );
  }
  box(g, [0.04, 0.19, width * 0.5], [-length / 2 - 0.01, 0.64, 0], dark);
  box(g, [0.07, 0.07, width * 0.98], [-length / 2 - 0.03, 0.49, 0], chrome);
  box(g, [0.08, 0.08, width * 0.98], [length / 2 - 0.04, 0.49, 0], chrome);
  return g;
}
export const catalog: ModelSpec[] = [
  {
    id: "wing",
    name: "Kanat profili",
    subtitle: "NACA 0012 · sonlu kanat",
    cd: 0.02,
    length: 1.2,
    build: wing,
  },
  {
    id: "cow",
    name: "İnek",
    subtitle: "Temsili geometri",
    cd: 0.9,
    length: 2.65,
    build: cow,
  },
  {
    id: "spider",
    name: "Fiat 124 Spider",
    subtitle: "Klasik roadster · temsili",
    cd: 0.45,
    length: 4.05,
    build: () => car(false),
  },
  {
    id: "sphere",
    name: "Küre",
    subtitle: "Çap 1 m · referans cisim",
    cd: 0.47,
    length: 1,
    build: () => {
      const g = new THREE.Group();
      part(g, new THREE.SphereGeometry(0.5, 48, 32), chrome, [0, 0, 0]);
      return g;
    },
  },
  {
    id: "cube",
    name: "Küp",
    subtitle: "Kenar 1 m · referans cisim",
    cd: 1.05,
    length: 1,
    build: () => {
      const g = new THREE.Group();
      box(g, [1, 1, 1], [0, 0, 0], blue);
      return g;
    },
  },
  {
    id: "connect",
    name: "Ford Connect",
    subtitle: "Hafif ticari · temsili",
    cd: 0.4,
    length: 4.4,
    build: () => car(true),
  },
];
export function centerModel(group: THREE.Group) {
  group.updateMatrixWorld(true);
  group.position.sub(
    new THREE.Box3().setFromObject(group).getCenter(new THREE.Vector3()),
  );
  const wrapper = new THREE.Group();
  wrapper.add(group);
  wrapper.updateMatrixWorld(true);
  return wrapper;
}
// Akışa dik yz düzleminde üçgenlerin birleşim alanı; örtüşen yüzler iki kez sayılmaz.
export function projectedArea(group: THREE.Object3D, resolution = 160): number {
  group.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(group),
    size = bounds.getSize(new THREE.Vector3());
  if (size.y < 1e-8 || size.z < 1e-8) return 0;
  const mask = new Uint8Array(resolution * resolution);
  const a = new THREE.Vector3(),
    b = new THREE.Vector3(),
    c = new THREE.Vector3();
  const toPixel = (v: THREE.Vector3) => {
    v.y = ((v.y - bounds.min.y) / size.y) * resolution;
    v.z = ((v.z - bounds.min.z) / size.z) * resolution;
  };
  const edge = (p: THREE.Vector3, q: THREE.Vector3, y: number, z: number) =>
    (q.y - p.y) * (z - p.z) - (q.z - p.z) * (y - p.y);
  group.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const pos = object.geometry.getAttribute("position"),
      index = object.geometry.index;
    if (!pos) return;
    const count = index ? index.count : pos.count;
    for (let i = 0; i + 2 < count; i += 3) {
      [a, b, c].forEach((v, j) => {
        v.fromBufferAttribute(
          pos,
          index ? index.getX(i + j) : i + j,
        ).applyMatrix4(object.matrixWorld);
        toPixel(v);
      });
      if (Math.abs(edge(a, b, c.y, c.z)) < 1e-8) continue;
      const minY = Math.max(0, Math.floor(Math.min(a.y, b.y, c.y))),
        maxY = Math.min(resolution - 1, Math.ceil(Math.max(a.y, b.y, c.y)));
      const minZ = Math.max(0, Math.floor(Math.min(a.z, b.z, c.z))),
        maxZ = Math.min(resolution - 1, Math.ceil(Math.max(a.z, b.z, c.z)));
      for (let y = minY; y <= maxY; y++)
        for (let z = minZ; z <= maxZ; z++) {
          if (mask[y * resolution + z]) continue;
          const e0 = edge(a, b, y + 0.5, z + 0.5),
            e1 = edge(b, c, y + 0.5, z + 0.5),
            e2 = edge(c, a, y + 0.5, z + 0.5);
          if (
            (e0 >= 0 && e1 >= 0 && e2 >= 0) ||
            (e0 <= 0 && e1 <= 0 && e2 <= 0)
          )
            mask[y * resolution + z] = 1;
        }
    }
  });
  return (mask.reduce((sum, x) => sum + x, 0) / mask.length) * size.y * size.z;
}
export function disposeObject(object: THREE.Object3D) {
  const textures = new Set<THREE.Texture>();
  object.traverse((o) => {
    if (!(
      o instanceof THREE.Mesh ||
      o instanceof THREE.Line ||
      o instanceof THREE.Points
    ))
      return;
    o.geometry.dispose();
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      for (const value of Object.values(m))
        if (value instanceof THREE.Texture) textures.add(value);
      m.dispose();
    }
  });
  // Yüklenen modelin önbelleği ile sahne kopyası aynı görüntüyü paylaşabilir.
  textures.forEach((t) => t.dispose());
}
