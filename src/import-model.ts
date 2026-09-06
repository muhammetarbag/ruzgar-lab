import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { disposeObject } from "./models";

export async function importModel(
  files: File[],
): Promise<{ group: THREE.Group; name: string; triangles: number }> {
  const models = files.filter((f) => /\.(glb|gltf|obj|stl)$/i.test(f.name));
  if (models.length !== 1)
    throw new Error(
      "Bir GLB, glTF, OBJ veya STL modeli seçin. glTF için .bin ve doku dosyalarını aynı seçimde ekleyin.",
    );
  if (files.reduce((sum, f) => sum + f.size, 0) > 50 * 1024 * 1024)
    throw new Error(
      "Toplam dosya boyutu en fazla 50 MB olabilir. Modeli küçültüp yeniden deneyin.",
    );
  const file = models[0],
    urls: string[] = [];
  const resourceErrors: string[] = [];
  const manager = new THREE.LoadingManager();
  manager.onError = () => resourceErrors.push("Modelin bağlı bir dosyası yüklenemedi.");
  manager.setURLModifier((url) => {
    // GLTFLoader creates blob URLs for embedded GLB/glTF images.
    if (url.startsWith("data:") || url.startsWith("blob:")) return url;
    const name = decodeURIComponent(url.split("/").pop() || "");
    const dependency = files.find((f) => f.name === name);
    if (!dependency) {
      resourceErrors.push(`Eksik model dosyası: ${name}.`);
      throw new Error(
        `Eksik model dosyası: ${name}. Model ve bağlı dosyalarını birlikte seçin.`,
      );
    }
    const blob = URL.createObjectURL(dependency);
    urls.push(blob);
    return blob;
  });
  let group: THREE.Group | undefined;
  try {
    if (/\.(gltf|glb)$/i.test(file.name)) {
      group = (
        await new GLTFLoader(manager).parseAsync(await file.arrayBuffer(), "")
      ).scene;
    } else if (/\.obj$/i.test(file.name)) {
      group = new OBJLoader().parse(await file.text());
    } else {
      group = new THREE.Group();
      group.add(
        new THREE.Mesh(
          new STLLoader().parse(await file.arrayBuffer()),
          new THREE.MeshStandardMaterial({
            color: "#7293a5",
            roughness: 0.5,
            metalness: 0.2,
          }),
        ),
      );
    }
    if (resourceErrors.length)
      throw new Error(`${resourceErrors[0]} Model ve bağlı dosyalarını birlikte seçin.`);
    let triangles = 0;
    group.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      if (
        object instanceof THREE.SkinnedMesh ||
        object instanceof THREE.InstancedMesh ||
        Object.keys(object.geometry.morphAttributes).length
      ) {
        throw new Error(
          "Animasyonlu, morph veya instanced geometri desteklenmiyor. Modeli statik mesh olarak dışa aktarın.",
        );
      }
      const positions = object.geometry.getAttribute("position");
      if (!positions) return;
      triangles += (object.geometry.index?.count ?? positions.count) / 3;
      if (triangles > 150000)
        throw new Error(
          "Model 150.000 üçgen sınırını aşıyor. Düşük poligonlu bir sürüm kullanın.",
        );
      for (let i = 0; i < positions.count; i++) {
        if (
          ![positions.getX(i), positions.getY(i), positions.getZ(i)].every(
            Number.isFinite,
          )
        )
          throw new Error("Model geçersiz koordinatlar içeriyor.");
      }
      object.castShadow = object.receiveShadow = true;
      if (!object.geometry.getAttribute("normal"))
        object.geometry.computeVertexNormals();
      for (const material of Array.isArray(object.material)
        ? object.material
        : [object.material])
        material.side = THREE.DoubleSide;
    });
    const size = new THREE.Box3()
      .setFromObject(group)
      .getSize(new THREE.Vector3());
    const longest = Math.max(size.x, size.y, size.z);
    if (!triangles || !Number.isFinite(longest) || longest < 1e-9)
      throw new Error("Dosyada kullanılabilir bir üçgen yüzey bulunamadı.");
    const normalized = new THREE.Group();
    normalized.add(group);
    normalized.scale.setScalar(1 / longest);
    return {
      group: normalized,
      name: file.name,
      triangles: Math.round(triangles),
    };
  } catch (error) {
    if (group) disposeObject(group);
    const message = error instanceof Error ? error.message : "Dosya okunamadı.";
    if (/draco|ktx|meshopt/i.test(message))
      throw new Error(
        "Sıkıştırılmış model desteklenmiyor. Draco / Meshopt / KTX sıkıştırması olmadan GLB dışa aktarın.",
      );
    throw new Error(message);
  } finally {
    urls.forEach(URL.revokeObjectURL);
  }
}
