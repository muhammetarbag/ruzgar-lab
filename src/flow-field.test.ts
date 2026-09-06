import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { catalog, centerModel } from "./models";
import { meshTriangles, voxelize, type FlowRequest } from "./flow-geometry";
import { solvePotential, sampleVelocity, traceStreamline, positionAtTime, isFluidSegment, type FlowGrid, type FlowField, type Point } from "./flow-field";

function request(id: string, pitch = 0, scale = 1): FlowRequest {
  const object = centerModel(catalog.find(model => model.id === id)!.build());
  object.scale.setScalar(scale);
  object.rotation.z = -pitch * Math.PI / 180; object.position.y = 3; object.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(object);
  return { meshes: meshTriangles(object), minimum: bounds.min.toArray() as Point, maximum: bounds.max.toArray() as Point, length: 18, height: 6, width: 8 };
}
function flux(field: FlowField, face: number): number {
  const { x, y, z } = field.grid, nx = x.length - 1, ny = y.length - 1;
  let result = 0;
  for (let k = 0; k < z.length - 1; k++) for (let j = 0; j < ny; j++)
    result += field.u[(k * ny + j) * (nx + 1) + face] * (y[j + 1] - y[j]) * (z[k + 1] - z[k]);
  return result;
}

describe("geometry-resolved potential flow", () => {
  it("empty tunnel is exactly uniform and particles follow physical travel time", () => {
    const grid: FlowGrid = { x: [-3, -1, 0, 1, 3], y: [0, 1, 2], z: [-1, 0, 1], solid: new Uint8Array(16) };
    const field = solvePotential(grid);
    expect(field.residual).toBe(0);
    expect(sampleVelocity(field, [0.5, 0.7, 0.3])).toEqual([1, 0, 0]);
    const path = traceStreamline(field, [-2.99, 0.7, 0.3]);
    expect(positionAtTime(path, 1)[0]).toBeCloseTo(-1.99, 8);
    expect(path.points.at(-1)![0]).toBeGreaterThan(2.99);
    for (const p of path.points) { expect(p[1]).toBe(0.7); expect(p[2]).toBe(0.3); }
  });

  const sphere = solvePotential(voxelize(request("sphere")));
  it("converges and conserves flux through every tunnel cross section", () => {
    expect(sphere.residual).toBeLessThan(1e-6);
    const inlet = flux(sphere, 0);
    expect(inlet).toBeCloseTo(48, 5);
    for (let i = 1; i < sphere.grid.x.length; i++) expect(Math.abs(flux(sphere, i) / inlet - 1)).toBeLessThan(2e-5);
  });
  it("has zero normal velocity on every solid face and tunnel side wall", () => {
    const { x, y, z, solid } = sphere.grid, nx = x.length - 1, ny = y.length - 1, nz = z.length - 1;
    for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const p = (k * ny + j) * nx + i;
      if (!solid[p]) continue;
      expect(sphere.u[(k * ny + j) * (nx + 1) + i]).toBe(0);
      expect(sphere.u[(k * ny + j) * (nx + 1) + i + 1]).toBe(0);
      expect(sphere.v[(k * (ny + 1) + j) * nx + i]).toBe(0);
      expect(sphere.v[(k * (ny + 1) + j + 1) * nx + i]).toBe(0);
      expect(sphere.w[p]).toBe(0); expect(sphere.w[p + nx * ny]).toBe(0);
    }
    for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) {
      expect(sphere.v[k * (ny + 1) * nx + i]).toBe(0);
      expect(sphere.v[(k * (ny + 1) + ny) * nx + i]).toBe(0);
    }
  });
  it("agrees with the analytic sphere field away from voxel-scale surface details", () => {
    // MIT potential flow: phi = U*x*(1 + a^3/(2*r^3)), a=0.5.
    for (const p of [[-1, 3, 0], [0, 4, 0], [-1, 3.7, 0], [0.7, 3.7, 0]] as Point[]) {
      const q: Point = [p[0], p[1] - 3, p[2]], r = Math.hypot(...q), a3 = 0.125;
      const exact = q.map((v, n) => (n === 0 ? 1 + a3 / (2 * r ** 3) : 0) - 3 * a3 * q[0] * v / (2 * r ** 5));
      const actual = sampleVelocity(sphere, p)!;
      for (let n = 0; n < 3; n++) expect(Math.abs(actual[n] - exact[n])).toBeLessThan(0.09);
    }
    expect(sampleVelocity(sphere, [-0.75, 3, 0])![0]).toBeLessThan(0.8);
    expect(sampleVelocity(sphere, [0, 3.75, 0])![0]).toBeGreaterThan(1.1);
  });
  it("sphere flow is symmetric and streamlines never enter the body", () => {
    const upper = sampleVelocity(sphere, [-0.8, 3.6, 0.2])!;
    const lower = sampleVelocity(sphere, [-0.8, 2.4, -0.2])!;
    expect(upper[0]).toBeCloseTo(lower[0], 5);
    expect(upper[1]).toBeCloseTo(-lower[1], 5);
    expect(upper[2]).toBeCloseTo(-lower[2], 5);
    for (const height of [2.5, 2.8, 3, 3.2, 3.5]) {
      const path = traceStreamline(sphere, [-8.99, height, 0]);
      for (const p of path.points) { expect(sampleVelocity(sphere, p)).not.toBeNull(); expect(Math.hypot(p[0], p[1] - 3, p[2])).toBeGreaterThan(0.5); }
    }
  });
  it("equal bounding boxes do not produce identical sphere and cube flow", () => {
    const cube = solvePotential(voxelize(request("cube")));
    // A cube corner accelerates/turns the flow differently from a round shoulder.
    expect(Math.abs(sampleVelocity(cube, [-0.4, 3.65, 0])![0] - sampleVelocity(sphere, [-0.4, 3.65, 0])![0])).toBeGreaterThan(0.05);
  });
  it("uses the rotated wing mesh and resolves a thin profile", () => {
    const positive = solvePotential(voxelize(request("wing", 10), 18));
    const negative = solvePotential(voxelize(request("wing", -10), 18));
    expect(positive.residual).toBeLessThan(1e-6);
    const a = sampleVelocity(positive, [0.1, 3.4, 0])!;
    const b = sampleVelocity(negative, [0.1, 2.6, 0])!;
    expect(a[1]).toBeCloseTo(-b[1], 4);
    expect(Math.abs(a[1])).toBeGreaterThan(0.01);
  });
  it("converges for the minimum-scale thin wing in the default tunnel", () => {
    const field = solvePotential(voxelize(request("wing", 0, 0.1)));
    expect(field.residual).toBeLessThan(1e-6);
    expect(flux(field, 0)).toBeCloseTo(flux(field, field.grid.x.length - 1), 3);
  });
  it("rejects a body intersecting the tunnel instead of drawing through the walls", () => {
    expect(() => voxelize({ ...request("connect"), width: 1 })).toThrow(/sığmıyor/);
  });
  it("does not bridge a thin solid interval between safe endpoints", () => {
    const grid: FlowGrid = { x: [0, 0.49, 0.5, 1], y: [0, 1], z: [0, 1], solid: new Uint8Array([0, 1, 0]) };
    expect(isFluidSegment(grid, [0.1, 0.5, 0.5], [0.9, 0.5, 0.5])).toBe(false);
    expect(isFluidSegment(grid, [0.1, 0.5, 0.5], [0.4, 0.5, 0.5])).toBe(true);
  });
  it("preserves an actual opening between meshes with a shared bounding box", () => {
    const object = new THREE.Group();
    for (const side of [-1, 1]) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 0.4, 1));
      mesh.position.y = 3 + side * 0.6; object.add(mesh);
    }
    const bounds = new THREE.Box3().setFromObject(object);
    const grid = voxelize({ ...request("cube"), meshes: meshTriangles(object), minimum: bounds.min.toArray() as Point, maximum: bounds.max.toArray() as Point });
    expect(isFluidSegment(grid, [-1, 3, 0], [1, 3, 0])).toBe(true);
    const field = solvePotential(grid);
    expect(sampleVelocity(field, [0, 3, 0])![0]).toBeGreaterThan(0.5);
  });
});
