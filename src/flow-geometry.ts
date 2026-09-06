import * as THREE from "three";
import { cellAt, type FlowGrid, type Point } from "./flow-field";

export interface FlowRequest {
  meshes: Float32Array[];
  minimum: Point;
  maximum: Point;
  length: number;
  height: number;
  width: number;
}

export function meshTriangles(object: THREE.Object3D): Float32Array[] {
  object.updateMatrixWorld(true);
  const meshes: Float32Array[] = [], point = new THREE.Vector3();
  object.traverse(child => {
    if (!(child instanceof THREE.Mesh)) return;
    const position = child.geometry.getAttribute("position"), index = child.geometry.index;
    if (!position) return;
    const count = index?.count ?? position.count, triangles = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      point.fromBufferAttribute(position, index ? index.getX(i) : i).applyMatrix4(child.matrixWorld);
      point.toArray(triangles, i * 3);
    }
    meshes.push(triangles);
  });
  return meshes;
}

// Keep resolution around the object, not in the mostly empty upstream tunnel.
export function clusteredAxis(low: number, high: number, bodyLow: number, bodyHigh: number, cells = 24): number[] {
  const padding = (bodyHigh - bodyLow) * 0.18;
  const a = Math.max(low, bodyLow - padding), b = Math.min(high, bodyHigh + padding);
  const result: number[] = [];
  const outer = 10, growth = 3;
  if (a > low) for (let i = outer; i > 0; i--)
    result.push(a - (a - low) * Math.expm1(growth * i / outer) / Math.expm1(growth));
  for (let i = 0; i <= cells; i++) result.push(a + (b - a) * i / cells);
  if (b < high) for (let i = 1; i <= outer; i++)
    result.push(b + (high - b) * Math.expm1(growth * i / outer) / Math.expm1(growth));
  result[0] = low; result[result.length - 1] = high;
  return result;
}

export function voxelize(request: FlowRequest, cells = 24): FlowGrid {
  const { minimum: min, maximum: max, length, height, width, meshes } = request;
  const lows: Point = [-length / 2, 0, -width / 2], highs: Point = [length / 2, height, width / 2];
  if (![...min, ...max, length, height, width].every(Number.isFinite) ||
      lows.some((v, n) => min[n] <= v || max[n] >= highs[n] || max[n] <= min[n]))
    throw new Error("Cisim tünele sığmıyor. Ölçeği küçültün veya tüneli büyütün.");
  const axes = lows.map((low, n) => clusteredAxis(low, highs[n], min[n], max[n], cells));
  const [x, y, z] = axes, nx = x.length - 1, ny = y.length - 1, nz = z.length - 1;
  const solid = new Uint8Array(nx * ny * nz);
  const centerY = y.slice(1).map((v, i) => (v + y[i]) / 2);
  const centerZ = z.slice(1).map((v, i) => (v + z[i]) / 2);
  const triangle = new THREE.Triangle(), box = new THREE.Box3();
  const vertices = [triangle.a, triangle.b, triangle.c];
  for (const mesh of meshes) {
    const rays: { x: number; sign: number }[][] = Array.from({ length: ny * nz }, () => []);
    for (let t = 0; t + 8 < mesh.length; t += 9) {
      vertices.forEach((v, n) => v.fromArray(mesh, t + n * 3));
      const [a, b, c] = vertices;
      const lower = [0, 1, 2].map(n => Math.min(a.getComponent(n), b.getComponent(n), c.getComponent(n)));
      const upper = [0, 1, 2].map(n => Math.max(a.getComponent(n), b.getComponent(n), c.getComponent(n)));
      const clippedCell = (value: number, axis: number[]) => value <= axis[0] ? 0
        : value >= axis[axis.length - 1] ? axis.length - 2 : cellAt(axis, value);
      const first = lower.map((v, n) => clippedCell(v - 1e-7, axes[n]));
      const last = upper.map((v, n) => clippedCell(v + 1e-7, axes[n]));
      // Conservative triangle/voxel overlap protects thin wings, oblique faces,
      // open sheets and details missed by a centre-only inside/outside test.
      for (let k = first[2]; k <= last[2]; k++) for (let j = first[1]; j <= last[1]; j++) for (let i = first[0]; i <= last[0]; i++) {
        const p = (k * ny + j) * nx + i;
        if (solid[p]) continue;
        box.min.set(x[i], y[j], z[k]); box.max.set(x[i + 1], y[j + 1], z[k + 1]);
        if (box.intersectsTriangle(triangle)) solid[p] = 1;
      }
      const denominator = (b.y - a.y) * (c.z - a.z) - (b.z - a.z) * (c.y - a.y);
      if (Math.abs(denominator) < 1e-12) continue;
      for (let k = first[2]; k <= last[2]; k++) for (let j = first[1]; j <= last[1]; j++) {
        const yy = centerY[j] - a.y, zz = centerZ[k] - a.z;
        const v = (yy * (c.z - a.z) - zz * (c.y - a.y)) / denominator;
        const w = ((b.y - a.y) * zz - (b.z - a.z) * yy) / denominator;
        if (v >= -1e-8 && w >= -1e-8 && v + w <= 1 + 1e-8)
          rays[k * ny + j].push({ x: a.x + v * (b.x - a.x) + w * (c.x - a.x), sign: Math.sign(denominator) });
      }
    }
    // Nonzero winding fills closed volumes. Separate meshes are unioned; their
    // overlapping parts must not create artificial holes (even/odd XOR).
    rays.forEach((hits, row) => {
      hits.sort((a, b) => a.x - b.x);
      const unique: typeof hits = [];
      for (const hit of hits) {
        const previous = unique[unique.length - 1];
        if (!previous || Math.abs(previous.x - hit.x) > 1e-6) unique.push({ ...hit });
        else if (previous.sign !== hit.sign) previous.sign = 0;
      }
      // An open sheet has no reliable interior. Its conservative surface cells
      // above still block flow; never invent an enclosing bounding-box volume.
      if (unique.reduce((sum, h) => sum + h.sign, 0) !== 0) return;
      let winding = 0;
      for (let h = 0; h + 1 < unique.length; h++) {
        winding += unique[h].sign;
        if (!winding) continue;
        for (let i = 0; i < nx; i++) {
          const mid = (x[i] + x[i + 1]) / 2;
          if (mid >= unique[h].x && mid <= unique[h + 1].x) solid[row * nx + i] = 1;
        }
      }
    });
  }
  return { x, y, z, solid };
}
