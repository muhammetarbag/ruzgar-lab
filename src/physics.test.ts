import { describe, expect, it } from "vitest";
import { calculate, defaults, sutherland } from "./physics";
import * as THREE from "three";
import { catalog, centerModel, orient, projectedArea } from "./models";

describe("Kuvvet ve hava koşulları", () => {
  const sphere = (changes = {}) =>
    calculate({ ...defaults, ...changes }, Math.PI / 4, Math.PI / 4, 1, false);
  it("standart havada yoğunluk ve viskoziteyi hesaplar", () => {
    expect(sphere().density).toBeCloseTo(1.225, 3);
    expect(sutherland(288.15)).toBeCloseTo(1.789e-5, 8);
    expect(sphere().drag).toBeCloseTo(90.44, 1);
  });
  it("hız iki katına çıkınca kuvvet dört katına ve Re iki katına çıkar", () => {
    expect(sphere({ speed: 40 }).drag).toBeCloseTo(sphere().drag! * 4);
    expect(sphere({ speed: 40 }).reynolds).toBeCloseTo(sphere().reynolds * 2);
  });
  it("mutlak basınç iki katına çıkınca yoğunluk ve kuvvet iki katına çıkar", () => {
    expect(sphere({ pressure: defaults.pressure * 2 }).drag).toBeCloseTo(
      sphere().drag! * 2,
    );
  });
  it("sıfır hızda sıfır kuvvet, Mach ve Reynolds verir", () => {
    const r = sphere({ speed: 0 });
    expect([r.drag, r.lift, r.mach, r.reynolds]).toEqual([0, 0, 0, 0]);
  });
  it("manuel viskozite Re değerini değiştirir, sürükleme katsayısını uydurmaz", () => {
    const r = sphere({
      autoViscosity: false,
      viscosity: sphere().viscosity * 2,
    });
    expect(r.reynolds).toBeCloseTo(sphere().reynolds / 2);
    expect(r.drag).toBe(sphere().drag);
  });
  it("manuel referans alanını ve negatif kaldırma katsayısını uygular", () => {
    const r = sphere({ manualArea: true, area: 2, cl: -0.5 });
    expect(r.area).toBe(2);
    expect(r.lift).toBeCloseTo(-r.dynamicPressure);
  });
  it("geçerlilik aralığı dışında otomatik kanat kuvveti üretmez", () => {
    for (const change of [{ pitch: 13 }, { yaw: 16 }, { roll: 16 }]) {
      const r = calculate({ ...defaults, ...change }, 1, 4.32, 1.2, true);
      expect(r.wingOutsideRange).toBe(true);
      expect(r.drag).toBeNull();
      expect(r.lift).toBeNull();
    }
  });
  it("simetrik kanatta sıfır açıda sıfır kaldırma, ters açıda ters kaldırma verir", () => {
    const wing = (pitch: number) =>
      calculate({ ...defaults, pitch }, 1, 4.32, 1.2, true);
    expect(wing(0).lift).toBe(0);
    expect(wing(-6).lift).toBeCloseTo(-wing(6).lift!);
    expect(wing(-6).drag).toBeCloseTo(wing(6).drag!);
  });
  it("geçersiz fiziksel koşulları reddeder", () => {
    expect(() => sphere({ temperature: -273.15 })).toThrow();
    expect(() => sphere({ pressure: 0 })).toThrow();
    for (const value of [NaN, Infinity, -Infinity]) {
      for (const key of Object.keys(defaults)) {
        if (typeof defaults[key as keyof typeof defaults] === "number")
          expect(() => sphere({ [key]: value })).toThrow();
      }
      expect(() => calculate(defaults, value, 1, 1, false)).toThrow();
      expect(() => calculate(defaults, 1, value, 1, false)).toThrow();
      expect(() => calculate(defaults, 1, 1, value, false)).toThrow();
    }
    for (const change of [{ area: 0 }, { cd: -1 }, { scale: 0 },
      { tunnelWidth: 0 }, { tunnelHeight: 0 }, { tunnelLength: 0 }])
      expect(() => sphere(change)).toThrow();
  });
});

describe("Geometri izdüşümü", () => {
  it("kürede πr² alanını yaklaşık verir", () => {
    const model = centerModel(catalog.find((x) => x.id === "sphere")!.build());
    expect(projectedArea(model)).toBeCloseTo(Math.PI / 4, 2);
  });
  it("üst üste yüzleri iki kez saymaz, ölçeğin karesini uygular", () => {
    const group = new THREE.Group();
    group.add(
      new THREE.Mesh(new THREE.BoxGeometry(2, 3, 4)),
      new THREE.Mesh(new THREE.BoxGeometry(2, 3, 4)),
    );
    expect(projectedArea(group)).toBeCloseTo(12, 2);
    group.scale.setScalar(2);
    expect(projectedArea(group)).toBeCloseTo(48, 2);
  });
  it("yatay açı izdüşüm alanını değiştirir", () => {
    const group = new THREE.Group();
    group.add(new THREE.Mesh(new THREE.BoxGeometry(2, 3, 4)));
    expect(projectedArea(group)).toBeCloseTo(12);
    group.rotation.y = Math.PI / 2;
    expect(projectedArea(group)).toBeCloseTo(6);
  });
  it("tüm hazır modellerde sonlu boyut ve pozitif izdüşüm vardır", () => {
    for (const spec of catalog) {
      const model = centerModel(spec.build());
      expect(projectedArea(model)).toBeGreaterThan(0);
      expect(
        new THREE.Box3()
          .setFromObject(model)
          .getCenter(new THREE.Vector3())
          .length(),
      ).toBeLessThan(1e-6);
    }
  });
});

describe("Yönelim: sapma → yunuslama → yatış", () => {
  const rad = Math.PI / 180;
  // Gövde eksenleri: burun −X'e, sağ kanat −Z'ye, aşağı −Y'ye bakar; hava +X yönünde akar.
  const axes = (yaw: number, pitch: number, roll: number) => {
    const o = new THREE.Object3D();
    orient(o, { yaw, pitch, roll });
    const q = o.quaternion;
    return {
      nose: new THREE.Vector3(-1, 0, 0).applyQuaternion(q),
      right: new THREE.Vector3(0, 0, -1).applyQuaternion(q),
      down: new THREE.Vector3(0, -1, 0).applyQuaternion(q),
    };
  };
  it("yatış sıfırken α ve β rüzgâr açılarına tam eşittir", () => {
    const { nose, right, down } = axes(30, 20, 0);
    const air = new THREE.Vector3(-1, 0, 0); // cismin havaya göre hızı
    const u = air.dot(nose), v = air.dot(right), w = air.dot(down);
    expect(Math.atan2(w, u) / rad).toBeCloseTo(20, 9);
    expect(Math.asin(v) / rad).toBeCloseTo(30, 9);
  });
  it("yatış en son ve gövde ekseni etrafında uygulanır; burnu oynatmaz", () => {
    const rolled = axes(30, 20, 60).nose, level = axes(30, 20, 0).nose;
    expect(rolled.distanceTo(level)).toBeLessThan(1e-12);
    expect(Math.asin(rolled.y) / rad).toBeCloseTo(20, 9);
  });
  it("pozitif yatış sağ kanadı indirir; büyük birleşik açılarda Euler bağıntısı tutar", () => {
    expect(axes(0, 0, 30).right.y).toBeCloseTo(-0.5, 12);
    for (const [yaw, pitch, roll] of [[30, 20, 60], [-120, 35, 150], [170, -40, -75]]) {
      const { nose, right } = axes(yaw, pitch, roll);
      expect(right.y).toBeCloseTo(-Math.sin(roll * rad) * Math.cos(pitch * rad), 12);
      expect(nose.y).toBeCloseTo(Math.sin(pitch * rad), 12);
      expect(Math.atan2(nose.z, -nose.x) / rad).toBeCloseTo(yaw, 9);
    }
  });
});
