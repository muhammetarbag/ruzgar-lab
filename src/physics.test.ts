import { describe, expect, it } from "vitest";
import { calculate, defaults, sutherland } from "./physics";
import * as THREE from "three";
import { catalog, centerModel, projectedArea } from "./models";

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
