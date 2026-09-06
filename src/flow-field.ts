// Finite-volume Laplace solve: u = grad(x + psi), div(u) = 0.
// Solid faces and tunnel side walls have zero normal flux (slip, not no-slip).
// Inlet/outlet set psi=0. No viscosity, circulation, Kutta condition or wake model.
export type Point = [number, number, number];
export interface FlowGrid {
  x: number[];
  y: number[];
  z: number[];
  solid: Uint8Array;
}
export interface FlowField {
  grid: FlowGrid;
  u: Float64Array;
  v: Float64Array;
  w: Float64Array;
  residual: number;
  iterations: number;
}
export interface FlowPath {
  points: Point[];
  times: number[]; // Travel time for a unit (1 m/s) reference flow.
  plane?: "xy" | "xz" | "volume";
}

export function cellAt(axis: number[], value: number): number {
  if (value < axis[0] || value >= axis[axis.length - 1]) return -1;
  let lo = 0, hi = axis.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >>> 1;
    if (axis[mid] <= value) lo = mid; else hi = mid;
  }
  return lo;
}

export function solvePotential(grid: FlowGrid, tolerance = 1e-6, maxIterations = 900): FlowField {
  const { x, y, z, solid } = grid;
  const nx = x.length - 1, ny = y.length - 1, nz = z.length - 1;
  const plane = nx * ny, count = plane * nz;
  const dx = x.slice(1).map((b, i) => b - x[i]);
  const dy = y.slice(1).map((b, i) => b - y[i]);
  const dz = z.slice(1).map((b, i) => b - z[i]);
  if (solid.length !== count || [...dx, ...dy, ...dz].some(d => !Number.isFinite(d) || d <= 0))
    throw new Error("Akış ağı geçersiz.");
  const diagonal = new Float64Array(count), rhs = new Float64Array(count);
  const cx = new Float64Array(count), cy = new Float64Array(count), cz = new Float64Array(count);
  // Store each shared-face conductance once: the resulting matrix is symmetric.
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const p = k * plane + j * nx + i;
    if (solid[p]) { diagonal[p] = 1; continue; }
    const area = dy[j] * dz[k];
    if (i === 0) { diagonal[p] += area * 2 / dx[i]; rhs[p] -= area; }
    if (i === nx - 1) { diagonal[p] += area * 2 / dx[i]; rhs[p] += area; }
    if (i + 1 < nx && !solid[p + 1]) {
      cx[p] = area * 2 / (dx[i] + dx[i + 1]);
      diagonal[p] += cx[p]; diagonal[p + 1] += cx[p];
      rhs[p] += area; rhs[p + 1] -= area;
    }
    if (j + 1 < ny && !solid[p + nx]) {
      cy[p] = dx[i] * dz[k] * 2 / (dy[j] + dy[j + 1]);
      diagonal[p] += cy[p]; diagonal[p + nx] += cy[p];
    }
    if (k + 1 < nz && !solid[p + plane]) {
      cz[p] = dx[i] * dy[j] * 2 / (dz[k] + dz[k + 1]);
      diagonal[p] += cz[p]; diagonal[p + plane] += cz[p];
    }
  }
  const apply = (input: Float64Array, output: Float64Array) => {
    for (let p = 0; p < count; p++) output[p] = diagonal[p] * input[p];
    for (let p = 0; p < count; p++) {
      if (cx[p]) { output[p] -= cx[p] * input[p + 1]; output[p + 1] -= cx[p] * input[p]; }
      if (cy[p]) { output[p] -= cy[p] * input[p + nx]; output[p + nx] -= cy[p] * input[p]; }
      if (cz[p]) { output[p] -= cz[p] * input[p + plane]; output[p + plane] -= cz[p] * input[p]; }
    }
  };
  // IC(0) preconditioning captures the strong coupling across a thin wing.
  // A diagonal-only preconditioner stalls on the highly stretched outer grid.
  const ld = new Float64Array(count), lx = new Float64Array(count), ly = new Float64Array(count), lz = new Float64Array(count);
  for (let p = 0; p < count; p++) {
    if (p >= 1 && cx[p - 1]) lx[p] = -cx[p - 1] / ld[p - 1];
    if (p >= nx && cy[p - nx]) ly[p] = -cy[p - nx] / ld[p - nx];
    if (p >= plane && cz[p - plane]) lz[p] = -cz[p - plane] / ld[p - plane];
    ld[p] = Math.sqrt(Math.max(diagonal[p] - lx[p] ** 2 - ly[p] ** 2 - lz[p] ** 2, diagonal[p] * 1e-10, 1e-14));
  }
  const preconditioned = new Float64Array(count);
  const precondition = (input: Float64Array) => {
    for (let p = 0; p < count; p++) {
      let value = input[p];
      if (lx[p]) value -= lx[p] * preconditioned[p - 1];
      if (ly[p]) value -= ly[p] * preconditioned[p - nx];
      if (lz[p]) value -= lz[p] * preconditioned[p - plane];
      preconditioned[p] = value / ld[p];
    }
    for (let p = count - 1; p >= 0; p--) {
      let value = preconditioned[p];
      if (cx[p]) value -= lx[p + 1] * preconditioned[p + 1];
      if (cy[p]) value -= ly[p + nx] * preconditioned[p + nx];
      if (cz[p]) value -= lz[p + plane] * preconditioned[p + plane];
      preconditioned[p] = value / ld[p];
    }
  };
  const psi = new Float64Array(count), r = rhs.slice(), direction = new Float64Array(count);
  const product = new Float64Array(count);
  let norm = 0, rz = 0;
  precondition(r);
  for (let p = 0; p < count; p++) {
    direction[p] = preconditioned[p];
    rz += r[p] * direction[p]; norm += rhs[p] ** 2;
  }
  let residual = norm ? 1 : 0, iterations = 0;
  for (; iterations < maxIterations && residual > tolerance; iterations++) {
    apply(direction, product);
    let dot = 0;
    for (let p = 0; p < count; p++) dot += direction[p] * product[p];
    if (dot <= 0 || !Number.isFinite(dot)) break;
    const alpha = rz / dot;
    let nextRz = 0, error = 0;
    for (let p = 0; p < count; p++) {
      psi[p] += alpha * direction[p]; r[p] -= alpha * product[p];
      error += r[p] ** 2;
    }
    precondition(r);
    for (let p = 0; p < count; p++) nextRz += r[p] * preconditioned[p];
    residual = Math.sqrt(error / norm);
    const beta = nextRz / rz;
    for (let p = 0; p < count; p++) direction[p] = preconditioned[p] + beta * direction[p];
    rz = nextRz;
  }
  // Recompute the actual residual, rather than trusting only the CG recurrence.
  apply(psi, product);
  let error = 0;
  for (let p = 0; p < count; p++) error += (rhs[p] - product[p]) ** 2;
  residual = norm ? Math.sqrt(error / norm) : 0;
  const u = new Float64Array((nx + 1) * ny * nz);
  const v = new Float64Array(nx * (ny + 1) * nz);
  const w = new Float64Array(nx * ny * (nz + 1));
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const p = k * plane + j * nx + i;
    if (solid[p]) continue;
    const ux = (k * ny + j) * (nx + 1) + i;
    if (i === 0) u[ux] = 1 + psi[p] * 2 / dx[i];
    if (i === nx - 1) u[ux + 1] = 1 - psi[p] * 2 / dx[i];
    else if (!solid[p + 1]) u[ux + 1] = 1 + (psi[p + 1] - psi[p]) * 2 / (dx[i] + dx[i + 1]);
    if (j + 1 < ny && !solid[p + nx])
      v[(k * (ny + 1) + j + 1) * nx + i] = (psi[p + nx] - psi[p]) * 2 / (dy[j] + dy[j + 1]);
    if (k + 1 < nz && !solid[p + plane])
      w[((k + 1) * ny + j) * nx + i] = (psi[p + plane] - psi[p]) * 2 / (dz[k] + dz[k + 1]);
  }
  // Normalize to unit mean inlet speed. Setting a potential drop alone would
  // otherwise reduce the inlet speed when the object/tunnel blockage changes.
  let flux = 0;
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) flux += u[(k * ny + j) * (nx + 1)] * dy[j] * dz[k];
  const mean = flux / ((y[ny] - y[0]) * (z[nz] - z[0]));
  if (mean > 1e-8) for (const component of [u, v, w]) for (let p = 0; p < component.length; p++) component[p] /= mean;
  else throw new Error("Tünelden geçen açık bir akış yolu yok.");
  return { grid, u, v, w, residual, iterations };
}

export function sampleVelocity(field: FlowField, point: Point): Point | null {
  const { grid: { x, y, z, solid }, u, v, w } = field;
  const nx = x.length - 1, ny = y.length - 1;
  const i = cellAt(x, point[0]), j = cellAt(y, point[1]), k = cellAt(z, point[2]);
  if (i < 0 || j < 0 || k < 0 || solid[(k * ny + j) * nx + i]) return null;
  const fx = (point[0] - x[i]) / (x[i + 1] - x[i]);
  const fy = (point[1] - y[j]) / (y[j + 1] - y[j]);
  const fz = (point[2] - z[k]) / (z[k + 1] - z[k]);
  const a = (k * ny + j) * (nx + 1) + i;
  const b = (k * (ny + 1) + j) * nx + i;
  const c = (k * ny + j) * nx + i;
  // RT0 reconstruction preserves normal-face flux and cell divergence. Unlike
  // averaging cell-centred velocities across a solid, it cannot leak into it.
  return [u[a] * (1 - fx) + u[a + 1] * fx, v[b] * (1 - fy) + v[b + nx] * fy, w[c] * (1 - fz) + w[c + nx * ny] * fz];
}

export function isFluidSegment(grid: FlowGrid, a: Point, b: Point): boolean {
  const axes = [grid.x, grid.y, grid.z], cuts = [0, 1];
  const start = axes.map((axis, n) => cellAt(axis, a[n]));
  const end = axes.map((axis, n) => cellAt(axis, b[n]));
  if ([...start, ...end].some(i => i < 0)) return false;
  for (let n = 0; n < 3; n++) {
    if (a[n] === b[n]) continue;
    for (let i = Math.min(start[n], end[n]) + 1; i <= Math.max(start[n], end[n]); i++)
      cuts.push((axes[n][i] - a[n]) / (b[n] - a[n]));
  }
  cuts.sort((p, q) => p - q);
  for (let s = 0; s + 1 < cuts.length; s++) {
    const t = (cuts[s] + cuts[s + 1]) / 2;
    const [i, j, k] = axes.map((axis, n) => cellAt(axis, a[n] + (b[n] - a[n]) * t));
    if (grid.solid[(k * (grid.y.length - 1) + j) * (grid.x.length - 1) + i]) return false;
  }
  return !grid.solid[(end[2] * (grid.y.length - 1) + end[1]) * (grid.x.length - 1) + end[0]];
}

export function traceStreamline(field: FlowField, seed: Point): FlowPath {
  const { x, y, z } = field.grid;
  const points: Point[] = [[...seed]], times = [0];
  const length = x[x.length - 1] - x[0];
  for (let step = 0; step < 4000; step++) {
    const p = points[points.length - 1], velocity = sampleVelocity(field, p);
    if (!velocity || Math.hypot(...velocity) < 0.015 || p[0] >= x[x.length - 1] - 1e-5) break;
    const cell = [cellAt(x, p[0]), cellAt(y, p[1]), cellAt(z, p[2])];
    const widths = [x, y, z].map((axis, n) => axis[cell[n] + 1] - axis[cell[n]]);
    let dt = Math.min(length / 180, 0.22 / Math.max(...velocity.map((v, n) => Math.abs(v) / widths[n])));
    let next: Point | undefined;
    for (let retry = 0; retry < 12; retry++, dt *= 0.5) {
      const mid = p.map((value, n) => value + velocity[n] * dt / 2) as Point;
      const mv = sampleVelocity(field, mid);
      if (!mv) continue;
      const candidate = p.map((value, n) => value + mv[n] * dt) as Point;
      // Check the actual drawn segment too; no smoothing through a solid corner.
      if (isFluidSegment(field.grid, p, candidate)) {
        next = candidate; break;
      }
    }
    if (!next || dt < 1e-7 || times[times.length - 1] > length * 12) break;
    points.push(next); times.push(times[times.length - 1] + dt);
  }
  return { points, times };
}

export function positionAtTime(path: FlowPath, time: number): Point {
  const { points, times } = path;
  if (time <= 0) return points[0];
  if (time >= times[times.length - 1]) return points[points.length - 1];
  let lo = 0, hi = times.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >>> 1; if (times[mid] <= time) lo = mid; else hi = mid; }
  const f = (time - times[lo]) / (times[hi] - times[lo]);
  return points[lo].map((v, n) => v + (points[hi][n] - v) * f) as Point;
}
