import { solvePotential, traceStreamline, type FlowPath, type Point } from "./flow-field";
import { voxelize, type FlowRequest } from "./flow-geometry";

export interface FlowResponse {
  paths: FlowPath[];
  residual: number;
  error?: string;
}

self.onmessage = (event: MessageEvent<FlowRequest>) => {
  try {
    const request = event.data, grid = voxelize(request), field = solvePotential(grid);
    if (!Number.isFinite(field.residual) || field.residual > 1e-5)
      throw new Error("Akış hesabı yakınsamadı. Tüneli büyütün veya cismi küçültün.");
    const size = request.maximum.map((v, n) => v - request.minimum[n]);
    const extentY = Math.min(request.height * 0.43, Math.max(size[1] * 1.15, size[0] * 0.55));
    const extentZ = Math.min(request.width * 0.35, size[2] * 0.32);
    const paths: FlowPath[] = [];
    for (const layer of [-1, 0, 1]) for (let row = -4; row <= 4; row++) {
      const seed: Point = [-request.length / 2 + 1e-6, request.height / 2 + row / 4 * extentY, layer * extentZ];
      const path = traceStreamline(field, seed);
      if (path.points.length > 2) paths.push({ ...path, plane: layer === 0 ? "xy" : "volume" });
    }
    const topExtent = Math.min(request.width * 0.43, Math.max(size[2] * 1.15, size[0] * 0.55));
    for (let row = -4; row <= 4; row++) {
      const path = traceStreamline(field, [-request.length / 2 + 1e-6, request.height / 2, row / 4 * topExtent]);
      if (path.points.length > 2) paths.push({ ...path, plane: "xz" });
    }
    self.postMessage({ paths, residual: field.residual } satisfies FlowResponse);
  } catch (error) {
    self.postMessage({ paths: [], residual: 1, error: error instanceof Error ? error.message : "Akış hesaplanamadı." } satisfies FlowResponse);
  }
};
