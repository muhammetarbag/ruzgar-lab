import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { centerModel, disposeObject, projectedArea } from "./models";
import type { Conditions } from "./physics";

export type DisplayMode = "flow" | "pressure" | "combined";

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
  private paths: THREE.Vector3[][] = [];
  private dots = new THREE.Points();
  private phase = 0;
  private running = !matchMedia("(prefers-reduced-motion: reduce)").matches;
  private showLines = true;
  private showParticles = true;
  private showVectors = false;
  private displayMode: DisplayMode = "flow";
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

  setObject(group: THREE.Group) {
    this.restoreMaterials();
    this.scene.remove(this.object);
    disposeObject(this.object);
    this.object = centerModel(group);
    this.geometrySize = new THREE.Box3()
      .setFromObject(this.object)
      .getSize(new THREE.Vector3());
    this.scene.add(this.object);
    this.update(this.state, true);
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
    disposeObject(this.flow);
    this.flow.clear();
    disposeObject(this.vectors);
    this.vectors.clear();
    this.paths = [];
    const s = this.state,
      size = this.bounds.getSize(new THREE.Vector3());
    const rx = Math.max(size.x / 2, 0.25),
      ry = Math.max(size.y / 2, 0.12),
      rz = Math.max(size.z / 2, 0.15);
    const segments = 110,
      rows = 9,
      layers = 3;
    const lines = new THREE.Group();
    lines.name = "lines";
    lines.visible = this.showLines;
    for (let layer = 0; layer < layers; layer++)
      for (let row = 0; row < rows; row++) {
        const y0 = ((row + 0.5) / rows - 0.5) * s.tunnelHeight * 0.85;
        const z0 =
          ((layer + 0.5) / layers - 0.5) * s.tunnelWidth * 0.72 + 0.025;
        const r = Math.sqrt((y0 / ry) ** 2 + (z0 / rz) ** 2);
        const path: THREE.Vector3[] = [];
        for (let j = 0; j <= segments; j++) {
          const x = (j / segments - 0.5) * s.tunnelLength;
          // Şematik yollar: geometriyi çevreleyen kutu boyutlarından yumuşak sapma.
          // Navier–Stokes veya yerel hız / basınç alanı çözümü değildir.
          const bump = Math.exp(-Math.pow(Math.abs(x) / (rx * 1.5 + 0.3), 4));
          const factor = Math.sqrt(r * r + 2.8 * bump) / Math.max(r, 0.001);
          const y = s.tunnelHeight / 2 + y0 * factor;
          const z = z0 * factor;
          const point = new THREE.Vector3(x, y, z);
          path.push(point);
        }
        this.paths.push(path);
        const curve = new THREE.CatmullRomCurve3(path, false, "centripetal");
        lines.add(new THREE.Mesh(
          new THREE.TubeGeometry(curve, segments, 0.014, 5, false),
          new THREE.MeshBasicMaterial({ color: "#8acfe5", toneMapped: false }),
        ));
      }
    this.flow.add(lines);
    const dotGeometry = new THREE.BufferGeometry();
    dotGeometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(
        new Float32Array(this.paths.length * 5 * 3),
        3,
      ),
    );
    this.dots = new THREE.Points(
      dotGeometry,
      new THREE.PointsMaterial({
        color: "#efae70",
        toneMapped: false,
        size: 0.10,
        transparent: true,
        opacity: 1,
        sizeAttenuation: true,
      }),
    );
    this.dots.visible = this.showParticles;
    this.flow.add(this.dots);
    this.updateParticles();
    this.flow.visible = this.displayMode !== "pressure" && s.speed > 0;
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
    const y = this.state.tunnelHeight / 2;
    const target = new THREE.Vector3(0, y, 0);
    this.controls.target.copy(target);
    if (view === "side") this.camera.position.set(0, y + 0.01, 15);
    else if (view === "top") this.camera.position.set(0, y + 18, 0.01);
    else if (view === "front") this.camera.position.set(-15, y + 0.01, 0);
    else this.camera.position.set(-6.5, y + 4, 9);
    this.camera.lookAt(target);
    this.controls.update();
  }
  setRunning(running: boolean) {
    this.running = running;
  }
  isRunning() {
    return this.running;
  }
  private updateParticles() {
    if (!this.paths.length) return;
    const positions = this.dots.geometry.getAttribute("position");
    const p = new THREE.Vector3();
    this.paths.forEach((path, i) => {
      for (let n = 0; n < 5; n++) {
        const f =
          ((this.phase + n / 5 + (i % 11) / 11) % 1) * (path.length - 1);
        const j = Math.floor(f);
        p.lerpVectors(path[j], path[Math.min(j + 1, path.length - 1)], f - j);
        const wake =
          Math.max(0, p.x - this.bounds.max.x) / this.state.tunnelLength;
        p.y +=
          ((Math.sin(p.x * 3 + i + this.phase * 40) * this.state.turbulence) /
            100) *
          wake *
          2;
        positions.setXYZ(i * 5 + n, p.x, p.y, p.z);
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
      this.phase += ((dt * this.state.speed) / this.state.tunnelLength) * 0.16;
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
    cancelAnimationFrame(this.frame);
    this.observer.disconnect();
    this.controls.dispose();
    this.restoreMaterials();
    disposeObject(this.scene);
    this.pressureMaterial.dispose();
    this.renderer.dispose();
  }
}
