import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { centerModel, disposeObject, projectedArea } from "./models";
import type { Conditions } from "./physics";
import { positionAtTime, type FlowPath, type Point } from "./flow-field";
import { meshTriangles, type FlowRequest } from "./flow-geometry";
import type { FlowResponse } from "./flow.worker";

export type DisplayMode = "flow" | "pressure" | "combined";

class FlowCurve extends THREE.Curve<THREE.Vector3> {
  private next = new THREE.Vector3();
  constructor(private points: Point[]) { super(); }
  override getPoint(t: number, target = new THREE.Vector3()) {
    const index = t * (this.points.length - 1), i = Math.min(Math.floor(index), this.points.length - 2);
    return target.fromArray(this.points[i]).lerp(this.next.fromArray(this.points[i + 1]), index - i);
  }
  // Tube vertices must hit every traced sample, including sharp voxel corners.
  override getPointAt(t: number, target = new THREE.Vector3()) { return this.getPoint(t, target); }
  override getTangentAt(t: number, target = new THREE.Vector3()) { return this.getTangent(t, target); }
}

export class TunnelScene {
  renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(40, 1, 0.05, 300);
  private controls: OrbitControls;
  private object = new THREE.Group();
  private tunnel = new THREE.Group();
  private flow = new THREE.Group();
  private vectors = new THREE.Group();
  private bounds = new THREE.Box3();
  private state!: Conditions;
  private paths: FlowPath[] = [];
  private renderedPaths: FlowPath[] = [];
  private flowWorker?: Worker;
  private flowTimer = 0;
  private dots = new THREE.Points();
  private phase = 0;
  private running = !matchMedia("(prefers-reduced-motion: reduce)").matches;
  private showLines = true;
  private showParticles = true;
  private showVectors = false;
  private displayMode: DisplayMode = "flow";
  private currentView = "perspective";
  private originalMaterials = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
  // Yalnızca yüzey yönelimine bağlı öğretici renkler; basınç / Cp çözümü değil.
  private pressureMaterial = new THREE.ShaderMaterial({
    uniforms: { windOn: { value: 1 } },
    vertexShader: `
      varying float facing;
      void main() {
        vec3 n = normalize(normalMatrix * normal);
        vec3 worldNormal = normalize(vec3(dot(viewMatrix[0].xyz, n), dot(viewMatrix[1].xyz, n), dot(viewMatrix[2].xyz, n)));
        facing = max(0.0, -worldNormal.x);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float windOn;
      varying float facing;
      void main() {
        vec3 blue = vec3(0.10, 0.32, 0.78);
        vec3 yellow = vec3(1.0, 0.82, 0.24);
        vec3 red = vec3(0.87, 0.15, 0.12);
        float t = clamp(facing, 0.0, 1.0);
        vec3 color = t < 0.5 ? mix(blue, yellow, t * 2.0) : mix(yellow, red, (t - 0.5) * 2.0);
        gl_FragColor = vec4(mix(vec3(0.63, 0.69, 0.73), color, windOn), 1.0);
      }
    `,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  private frame = 0;
  private observer: ResizeObserver;
  private lastTime = performance.now();
  private geometrySize = new THREE.Vector3(1, 1, 1);
  private areaCache = 0;

  constructor(
    private host: HTMLElement,
    state: Conditions,
  ) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true,
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setClearColor("#102330", 1);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.3;
    this.renderer.domElement.setAttribute(
      "aria-label",
      "Etkileşimli rüzgâr tüneli. Fare ile döndürün; tekerlek ile yakınlaştırın. Klavye için görünüm düğmelerini kullanın.",
    );
    this.renderer.domElement.setAttribute("role", "img");
    host.prepend(this.renderer.domElement);
    this.scene.fog = new THREE.Fog("#102330", 25, 65);
    this.scene.add(new THREE.HemisphereLight("#ffffff", "#9bafbd", 3));
    const sun = new THREE.DirectionalLight("#fff5e7", 4);
    sun.position.set(-4, 12, 7);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, {
      left: -15,
      right: 15,
      top: 15,
      bottom: -15,
    });
    sun.shadow.bias = -0.0004;
    this.scene.add(sun, this.object, this.tunnel, this.flow, this.vectors);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.minDistance = 2;
    this.controls.maxDistance = 70;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.015;
    this.state = { ...state };
    this.setView("perspective");
    this.observer = new ResizeObserver(() => {
      const w = host.clientWidth,
        h = host.clientHeight;
      this.renderer.setSize(w, h);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    });
    this.observer.observe(host);
    this.makeTunnel();
    this.animate();
  }

  setObject(group: THREE.Group, state: Conditions = this.state) {
    this.restoreMaterials();
    this.scene.remove(this.object);
    disposeObject(this.object);
    this.object = centerModel(group);
    this.geometrySize = new THREE.Box3()
      .setFromObject(this.object)
      .getSize(new THREE.Vector3());
    this.scene.add(this.object);
    this.update(state, true);
    this.setView(this.currentView);
    this.applyDisplayMaterial();
  }

  update(s: Conditions, geometryChanged = false) {
    const tunnelChanged = ["tunnelLength", "tunnelWidth", "tunnelHeight"].some(
      (k) => s[k as keyof Conditions] !== this.state[k as keyof Conditions],
    );
    this.state = { ...s };
    this.pressureMaterial.uniforms.windOn.value = s.speed > 0 ? 1 : 0;
    if (geometryChanged || tunnelChanged) {
      this.object.rotation.set(
        (s.roll * Math.PI) / 180,
        (s.yaw * Math.PI) / 180,
        (-s.pitch * Math.PI) / 180,
        "YXZ",
      );
      this.object.scale.setScalar(s.scale);
      this.object.position.set(0, s.tunnelHeight / 2, 0);
      this.object.updateMatrixWorld(true);
      this.bounds.setFromObject(this.object);
      this.areaCache = projectedArea(this.object);
      if (tunnelChanged) this.makeTunnel();
      this.makeFlow();
    }
    this.flow.visible = this.displayMode !== "pressure" && s.speed > 0;
    this.vectors.visible = this.displayMode !== "pressure" && this.showVectors && s.speed > 0;
    return {
      projectedArea: this.areaCache,
      size: this.bounds.getSize(new THREE.Vector3()),
      originalSize: this.geometrySize.clone().multiplyScalar(s.scale),
    };
  }

  private makeTunnel() {
    disposeObject(this.tunnel);
    this.tunnel.clear();
    const s = this.state;
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(s.tunnelLength + 6, s.tunnelWidth + 5),
      new THREE.MeshStandardMaterial({ color: "#172d3b", roughness: 0.9 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.03;
    floor.receiveShadow = true;
    this.tunnel.add(floor);
    const grid = new THREE.GridHelper(
      Math.max(s.tunnelLength, s.tunnelWidth) + 4,
      Math.max(s.tunnelLength, s.tunnelWidth) + 4,
      "#53758c",
      "#39576c",
    );
    grid.material.transparent = true;
    grid.material.opacity = 0.23;
    grid.position.y = -0.02;
    this.tunnel.add(grid);
    const edges = new THREE.EdgesGeometry(
      new THREE.BoxGeometry(s.tunnelLength, s.tunnelHeight, s.tunnelWidth),
    );
    const cage = new THREE.LineSegments(
      edges,
      new THREE.LineBasicMaterial({
        color: "#88a7ba",
        transparent: true,
        opacity: 0.38,
      }),
    );
    cage.position.y = s.tunnelHeight / 2;
    this.tunnel.add(cage);
    for (const x of [-s.tunnelLength / 2, s.tunnelLength / 2]) {
      const frame = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(x, 0, -s.tunnelWidth / 2),
          new THREE.Vector3(x, s.tunnelHeight, -s.tunnelWidth / 2),
          new THREE.Vector3(x, s.tunnelHeight, s.tunnelWidth / 2),
          new THREE.Vector3(x, 0, s.tunnelWidth / 2),
        ]),
        new THREE.LineBasicMaterial({
          color: "#6e96aa",
          transparent: true,
          opacity: 0.6,
        }),
      );
      this.tunnel.add(frame);
    }
  }

  private makeFlow() {
    clearTimeout(this.flowTimer);
    this.flowWorker?.terminate();
    this.flowWorker = undefined;
    disposeObject(this.flow);
    this.flow.clear();
    this.paths = [];
    this.renderedPaths = [];
    const status = document.querySelector<HTMLElement>("#flow-status")!;
    status.dataset.state = "pending";
    delete status.dataset.residual;
    delete status.dataset.paths;
    status.textContent = "Geometriye göre akış hesaplanıyor…";
    // Coalesce slider changes and discard every obsolete geometry calculation.
    this.flowTimer = window.setTimeout(() => {
      const worker = new Worker(new URL("./flow.worker.ts", import.meta.url), { type: "module" });
      this.flowWorker = worker;
      const request: FlowRequest = {
        meshes: meshTriangles(this.object),
        minimum: this.bounds.min.toArray() as [number, number, number],
        maximum: this.bounds.max.toArray() as [number, number, number],
        length: this.state.tunnelLength, height: this.state.tunnelHeight, width: this.state.tunnelWidth,
      };
      const fail = (message: string) => {
        if (this.flowWorker !== worker) return;
        status.dataset.state = "error";
        status.textContent = `Akış gösterilemiyor: ${message}`;
        worker.terminate();
        this.flowWorker = undefined;
      };
      worker.onerror = () => fail("Hesaplama başlatılamadı. Sayfayı yenileyin.");
      worker.onmessage = (event: MessageEvent<FlowResponse>) => {
        if (this.flowWorker !== worker) return;
        const response = event.data;
        if (response.error) { fail(response.error); return; }
        this.paths = response.paths;
        this.drawFlow();
        status.dataset.state = "ready";
        status.dataset.residual = String(response.residual);
        status.dataset.paths = String(this.paths.length);
        status.textContent = "İdeal akış · geometriye göre hesaplandı";
        worker.terminate();
        this.flowWorker = undefined;
      };
      worker.postMessage(request, request.meshes.map(mesh => mesh.buffer));
    }, 120);
  }

  private drawFlow() {
    disposeObject(this.flow);
    this.flow.clear();
    this.renderedPaths = this.paths.filter(path => this.currentView === "side"
      ? path.plane === "xy" : this.currentView === "top" ? path.plane === "xz" : path.plane !== "xz");
    const lines = new THREE.Group();
    lines.name = "lines";
    lines.visible = this.showLines;
    const radius = Math.min(0.012, Math.max(0.003, this.bounds.getSize(new THREE.Vector3()).length() * 0.003));
    for (const path of this.renderedPaths) {
      // Piecewise linear curve: Catmull-Rom overshoot can cross a solid surface.
      const curve = new FlowCurve(path.points);
      lines.add(new THREE.Mesh(
        new THREE.TubeGeometry(curve, path.points.length - 1, radius, 4, false),
        new THREE.MeshBasicMaterial({ color: "#8acfe5", toneMapped: false, transparent: true, opacity: 0.7 }),
      ));
    }
    this.flow.add(lines);
    const dotGeometry = new THREE.BufferGeometry();
    dotGeometry.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(this.renderedPaths.length * 5 * 3), 3));
    this.dots = new THREE.Points(dotGeometry, new THREE.PointsMaterial({
      color: "#efae70", toneMapped: false, size: radius * 7, sizeAttenuation: true,
    }));
    this.dots.visible = this.showParticles;
    this.flow.add(this.dots);
    this.updateParticles();
    this.flow.visible = this.displayMode !== "pressure" && this.state.speed > 0;
  }

  setForces(drag: number | null, lift: number | null) {
    disposeObject(this.vectors);
    this.vectors.clear();
    const origin = new THREE.Vector3(
      0,
      this.state.tunnelHeight / 2,
      this.bounds.max.z + 0.3,
    );
    if (drag !== null && drag > 0)
      this.vectors.add(
        new THREE.ArrowHelper(
          new THREE.Vector3(1, 0, 0),
          origin,
          Math.min(4, 0.6 + Math.log10(1 + drag)),
          "#c57936",
          0.2,
          0.12,
        ),
      );
    if (lift !== null && Math.abs(lift) > 0.01)
      this.vectors.add(
        new THREE.ArrowHelper(
          new THREE.Vector3(0, Math.sign(lift), 0),
          origin,
          Math.min(3, 0.5 + Math.log10(1 + Math.abs(lift))),
          "#56875c",
          0.2,
          0.12,
        ),
      );
    this.vectors.visible = this.displayMode !== "pressure" && this.showVectors && this.state.speed > 0;
  }
  setDisplayMode(mode: DisplayMode) {
    this.displayMode = mode;
    this.flow.visible = mode !== "pressure" && this.state.speed > 0;
    this.vectors.visible = mode !== "pressure" && this.showVectors && this.state.speed > 0;
    this.object.visible = true;
    this.applyDisplayMaterial();
  }
  private restoreMaterials() {
    this.originalMaterials.forEach((material, mesh) => { mesh.material = material; });
    this.originalMaterials.clear();
  }
  private applyDisplayMaterial() {
    this.restoreMaterials();
    if (this.displayMode === "flow") return;
    this.object.traverse(o => {
      if (!(o instanceof THREE.Mesh)) return;
      this.originalMaterials.set(o, o.material);
      o.material = this.pressureMaterial;
    });
  }
  setLayer(name: string, enabled: boolean) {
    if (name === "lines") {
      this.showLines = enabled;
      const lines = this.flow.getObjectByName("lines");
      if (lines) lines.visible = enabled;
    }
    if (name === "particles") {
      this.showParticles = enabled;
      this.dots.visible = enabled;
    }
    if (name === "vectors") {
      this.showVectors = enabled;
      this.vectors.visible = this.displayMode !== "pressure" && enabled && this.state.speed > 0;
    }
    if (name === "wireframe") {
      this.pressureMaterial.wireframe = enabled;
      this.originalMaterials.forEach(material => {
        for (const m of Array.isArray(material) ? material : [material])
          if ("wireframe" in m) m.wireframe = enabled;
      });
      this.object.traverse((o) => {
        if (o instanceof THREE.Mesh)
          for (const m of Array.isArray(o.material) ? o.material : [o.material])
            if ("wireframe" in m) m.wireframe = enabled;
      });
    }
  }
  setView(view: string) {
    this.currentView = view;
    const y = this.state.tunnelHeight / 2;
    const target = new THREE.Vector3(0, y, 0);
    const size = this.bounds.isEmpty() ? new THREE.Vector3(3, 2, 3) : this.bounds.getSize(new THREE.Vector3());
    const tangent = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const fit = (width: number, height: number) => Math.max(2.5, 1.7 * Math.max(width / this.camera.aspect, height) / (2 * tangent));
    this.controls.target.copy(target);
    if (view === "side") this.camera.position.set(0, y + 0.001, fit(size.x, size.y) + size.z / 2);
    else if (view === "top") this.camera.position.set(0, y + fit(size.x, size.z) + size.y / 2, 0.001);
    else if (view === "front") this.camera.position.set(-fit(size.z, size.y) - size.x / 2, y + 0.001, 0);
    else this.camera.position.copy(new THREE.Vector3(-0.52, 0.32, 0.72).normalize().multiplyScalar(Math.max(3, size.length() * 2))).add(target);
    this.camera.lookAt(target);
    this.controls.update();
    const slice = document.querySelector<HTMLElement>("#flow-slice");
    if (slice) slice.textContent = view === "side" ? "Yan görünüm: başlangıç düzlemi XY" : view === "top" ? "Üst görünüm: başlangıç düzlemi XZ" : "3D görünüm: üç akış düzlemi";
    if (this.paths.length) this.drawFlow();
  }
  setRunning(running: boolean) {
    this.running = running;
  }
  isRunning() {
    return this.running;
  }
  private updateParticles() {
    if (!this.renderedPaths.length) return;
    const positions = this.dots.geometry.getAttribute("position");
    this.renderedPaths.forEach((path, i) => {
      const duration = path.times[path.times.length - 1];
      for (let n = 0; n < 5; n++) {
        const time = (this.phase + (n / 5 + (i % 11) / 11) * duration) % duration;
        const p = positionAtTime(path, time);
        positions.setXYZ(i * 5 + n, ...p);
      }
    });
    positions.needsUpdate = true;
  }
  private animate = () => {
    this.frame = requestAnimationFrame(this.animate);
    const now = performance.now(),
      dt = Math.min((now - this.lastTime) / 1000, 0.05);
    this.lastTime = now;
    if (this.running && !document.hidden && this.state.speed > 0) {
      this.phase += dt * this.state.speed * 0.16;
      this.updateParticles();
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };
  snapshot(): Promise<Blob> {
    this.renderer.render(this.scene, this.camera);
    return new Promise((resolve, reject) =>
      this.renderer.domElement.toBlob(
        (blob) =>
          blob ? resolve(blob) : reject(new Error("Görüntü alınamadı.")),
        "image/png",
      ),
    );
  }
  dispose() {
    clearTimeout(this.flowTimer);
    this.flowWorker?.terminate();
    cancelAnimationFrame(this.frame);
    this.observer.disconnect();
    this.controls.dispose();
    this.restoreMaterials();
    disposeObject(this.scene);
    this.pressureMaterial.dispose();
    this.renderer.dispose();
  }
}
