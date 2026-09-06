export interface Conditions {
  speed: number;
  pressure: number;
  temperature: number;
  viscosity: number;
  autoViscosity: boolean;
  turbulence: number;
  yaw: number;
  pitch: number;
  roll: number;
  scale: number;
  cd: number;
  cl: number;
  autoWing: boolean;
  manualArea: boolean;
  area: number;
  tunnelWidth: number;
  tunnelHeight: number;
  tunnelLength: number;
}
export const defaults: Conditions = {
  speed: 20,
  pressure: 101325,
  temperature: 15,
  viscosity: 1.789e-5,
  autoViscosity: true,
  turbulence: 4,
  yaw: 0,
  pitch: 0,
  roll: 0,
  scale: 1,
  cd: 0.47,
  cl: 0,
  autoWing: true,
  manualArea: false,
  area: 1,
  tunnelWidth: 8,
  tunnelHeight: 6,
  tunnelLength: 18,
};
export function sutherland(temperatureK: number): number {
  return (
    (1.716e-5 * (temperatureK / 273.15) ** 1.5 * (273.15 + 110.4)) /
    (temperatureK + 110.4)
  );
}
export function calculate(
  s: Conditions,
  projectedArea: number,
  referenceArea: number,
  length: number,
  isWing: boolean,
) {
  const kelvin = s.temperature + 273.15;
  if (
    ![
      s.speed, s.pressure, s.temperature, s.viscosity, s.turbulence,
      s.yaw, s.pitch, s.roll, s.scale, s.cd, s.cl, s.area,
      s.tunnelWidth, s.tunnelHeight, s.tunnelLength,
      projectedArea, referenceArea, length,
    ].every(Number.isFinite) ||
    kelvin <= 0 ||
    s.pressure <= 0 ||
    s.speed < 0 ||
    length <= 0 ||
    referenceArea < 0 ||
    projectedArea < 0 ||
    s.viscosity <= 0 ||
    s.cd < 0 || s.area <= 0 || s.scale <= 0 ||
    s.tunnelWidth <= 0 || s.tunnelHeight <= 0 || s.tunnelLength <= 0
  )
    throw new Error("Fiziksel girdiler geçerli aralıkta olmalı.");
  const density = s.pressure / (287.05 * kelvin);
  const viscosity = s.autoViscosity ? sutherland(kelvin) : s.viscosity;
  const dynamicPressure = 0.5 * density * s.speed ** 2;
  const area = s.manualArea ? s.area : referenceArea;
  const wingAutomatic = isWing && s.autoWing;
  // Sonlu kanat, AR=3, e=0.8; küçük hücum açısı yaklaşımı. Stall çözülmez.
  const cl = wingAutomatic
    ? (2 * Math.PI * ((s.pitch * Math.PI) / 180)) / (1 + 2 / 3)
    : s.cl;
  const cd = wingAutomatic ? 0.02 + (cl * cl) / (Math.PI * 3 * 0.8) : s.cd;
  const wingOutsideRange =
    wingAutomatic &&
    (Math.abs(s.pitch) > 12 || Math.abs(s.yaw) > 15 || Math.abs(s.roll) > 15);
  return {
    density,
    viscosity,
    dynamicPressure,
    area,
    cd: wingOutsideRange ? null : cd,
    cl: wingOutsideRange ? null : cl,
    drag: wingOutsideRange ? null : dynamicPressure * area * cd,
    lift: wingOutsideRange ? null : dynamicPressure * area * cl,
    reynolds: (density * s.speed * length) / viscosity,
    mach: s.speed / Math.sqrt(1.4 * 287.05 * kelvin),
    blockage: (projectedArea / (s.tunnelWidth * s.tunnelHeight)) * 100,
    wingOutsideRange,
  };
}
export type Results = ReturnType<typeof calculate>;
