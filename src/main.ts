import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import "./style.css";
import * as THREE from "three";
import { catalog, centerModel, disposeObject, type ModelSpec } from "./models";
import { defaults, calculate, type Conditions, type Results } from "./physics";
import { TunnelScene, type DisplayMode } from "./scene";
import { importModel } from "./import-model";

const icon = (name: string, size = 18) => {
  const paths: Record<string, string> = {
    wind: '<path d="M3 8h12a3 3 0 1 0-3-3M3 12h18M3 16h9a3 3 0 1 1-3 3"/>',
    upload: '<path d="M12 16V3m-5 5 5-5 5 5M4 15v5h16v-5"/>',
    download: '<path d="M12 3v13m-5-5 5 5 5-5M4 16v5h16v-5"/>',
    play: '<path d="m8 4 12 8-12 8Z"/>',
    pause: '<path d="M8 5v14M16 5v14"/>',
    reset: '<path d="M3 10a9 9 0 1 1 2 8M3 4v6h6"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v1"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    camera:
      '<path d="M3 7h4l2-3h6l2 3h4v13H3Z"/><circle cx="12" cy="13" r="4"/>',
    cube: '<path d="m12 2 9 5v10l-9 5-9-5V7Zm0 10v10M3 7l9 5 9-5M7.5 4.5l9 5"/>',
    arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>',
    chart: '<path d="M4 4v16h17M8 15l4-5 4 3 5-7"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
  };
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.cube}</svg>`;
};
const $ = <T extends HTMLElement = HTMLElement>(selector: string) =>
  document.querySelector<T>(selector)!;
const number = (value: number | null, digits = 2) =>
  value === null
    ? "—"
    : new Intl.NumberFormat("tr-TR", {
        maximumFractionDigits: digits,
        minimumFractionDigits: digits,
      }).format(value);
const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );

let selected = catalog[0];
let state: Conditions = { ...defaults, cd: selected.cd, pitch: 6 };
let results: Results;
let customSource: THREE.Group | undefined;
let customSpec: ModelSpec | undefined;
interface Run {
  id: number;
  date: string;
  name: string;
  modelId: string;
  state: Conditions;
  results: Results;
  reference: string;
  length: number;
}
let runs: Run[] = [];
let runId = 0;
let currentLength = 1.2;

function control(
  key: keyof Conditions,
  title: string,
  unit: string,
  min: number,
  max: number,
  step: number,
  extra = "",
) {
  const value = state[key];
  return `<div class="control ${extra}"><div class="control-label"><label for="${key}">${title}</label><div class="value-input"><input id="${key}" data-key="${key}" type="number" min="${min}" max="${max}" step="${step}" value="${value}" aria-label="${title}"/><span>${unit}</span></div></div><input class="range" data-range="${key}" type="range" min="${min}" max="${max}" step="${step}" value="${value}" aria-label="${title} sürgüsü"/></div>`;
}

$("#app").innerHTML = `
  <header class="topbar">
    <a class="brand" href="./" aria-label="Rüzgâr Lab ana sayfa"><span class="brand-icon">${icon("wind", 28)}</span><span>Rüzgâr<span class="brand-light">lab</span><small>SANAL RÜZGÂR TÜNELİ</small></span></a>
    <div class="header-note"><span class="status-dot"></span> Keşfet. Değiştir. Karşılaştır.</div>
    <div class="header-actions"><span class="mode-pill">Eğitim modu</span><button id="help" class="button quiet">${icon("info")}<span>Nasıl çalışır?</span></button></div>
  </header>
  <main class="workspace">
    <aside class="sidebar left-sidebar" aria-label="Deney ayarları">
      <div class="sidebar-heading"><div><span class="eyebrow">DENEY DÜZENEĞİ</span><h1>Akışı keşfet.</h1></div>${icon("wind", 27)}</div>
      <section class="settings-section"><div class="section-heading"><h2>Hava koşulları</h2><span class="section-symbol">∞</span></div>
        <div class="preset-row"><button data-preset="standard" class="chip active">Standart</button><button data-preset="breeze" class="chip">Hafif esinti</button><button data-preset="strong" class="chip">Kuvvetli rüzgâr</button></div>
        ${control("speed", "Rüzgâr hızı", "m/s", 0, 100, 0.5, "primary-control")}
        <div class="range-endpoints"><span>0 m/s</span><span id="speed-kmh">72 km/sa</span><span>100 m/s</span></div>
        ${control("pressure", "Mutlak basınç", "Pa", 10000, 200000, 25)}
        ${control("temperature", "Sıcaklık", "°C", -50, 100, 1)}
        <div class="derived-row"><span>Hava yoğunluğu <span class="mono">ρ</span></span><strong id="density">—</strong></div>
        <details class="advanced"><summary>Diğer hava ayarları</summary><div class="details-body">
          <label class="check-row"><input type="checkbox" id="autoViscosity" checked/> Sıcaklıktan viskozite hesapla</label>
          ${control("viscosity", "Dinamik viskozite", "Pa·s", 0.000001, 0.0001, 0.000001)}
          ${control("turbulence", "İz bölgesi dalgalanması", "%", 0, 30, 1)}
          <p class="hint">Dalgalanma yalnızca parçacık animasyonunu etkiler; kuvvet hesabına girmez.</p>
        </div></details>
      </section>
      <section class="settings-section"><div class="section-heading"><h2>Cisim ve yönelim</h2>${icon("cube")}</div>
        ${control("scale", "Ölçek", "×", 0.1, 5, 0.1)}
        ${control("pitch", "Hücum açısı · α", "°", -45, 45, 1)}
        ${control("yaw", "Yatay açı · β", "°", -180, 180, 1)}
        <details class="advanced"><summary>Geometri ve katsayılar</summary><div class="details-body">
          ${control("roll", "Yatış açısı", "°", -180, 180, 1)}
          <label class="check-row" id="wing-auto-row"><input type="checkbox" id="autoWing" checked/> Kanat katsayılarını yaklaşık hesapla</label>
          ${control("cd", "Sürükleme katsayısı · Cᴅ", "", 0, 3, 0.01)}
          ${control("cl", "Kaldırma katsayısı · Cʟ", "", -3, 3, 0.01)}
          <p class="hint" id="coefficient-note">Katsayılar örnek varsayımlardır; ölçülmüş araç veya hayvan verisi değildir. Yönelim değişince manuel katsayıları da gözden geçirin.</p>
          <label class="check-row"><input type="checkbox" id="manualArea"/> Referans alanını elle gir</label>
          ${control("area", "Referans alanı", "m²", 0.0001, 1000, 0.01)}
          <p class="hint" id="area-note"></p>
        </div></details>
      </section>
      <section class="settings-section compact-section"><details class="advanced"><summary>Tünel boyutları</summary><div class="details-body">
        ${control("tunnelLength", "Uzunluk", "m", 6, 40, 1)}
        ${control("tunnelWidth", "Genişlik", "m", 2, 16, 1)}
        ${control("tunnelHeight", "Yükseklik", "m", 2, 12, 1)}
        <p class="hint">Duvar ve zemin etkileri kuvvet hesabına dahil değildir.</p>
      </div></details></section>
      <button id="reset" class="button reset-button">${icon("reset", 16)} Ayarları sıfırla</button>
    </aside>

    <div class="main-column">
      <section class="scene-card" aria-label="3D deney sahnesi">
        <div class="scene-top"><div><span class="eyebrow">TEST BÖLGESİ</span><h2 id="scene-title">Kanat profili <span>NACA 0012</span></h2></div><span class="live-badge" id="live-badge"><span class="status-dot"></span> Akış açık</span></div>
        <div id="viewport"><div class="flow-direction">HAVA AKIŞI ${icon("arrow", 25)} <span>+X</span></div><div class="scene-caption"><span id="dimension-label">—</span><span>1 ızgara aralığı = 1 m</span></div><div id="render-error" hidden></div></div>
        <div class="display-controls" role="group" aria-label="Gösterim modu">
          <span>GÖRÜNÜM</span>
          <button class="display-button active" data-display="flow" aria-pressed="true">Akış</button>
          <button class="display-button" data-display="pressure" aria-pressed="false">Basınç</button>
          <button class="display-button" data-display="combined" aria-pressed="false">Birlikte</button>
          <span class="object-visible-note">Cisim her görünümde görünür</span>
        </div>
        <div id="pressure-legend" hidden>
          <strong>Temsili — hesaplanan basınç değildir</strong>
          <div class="pressure-color-key"><span>Mavi</span><span class="pressure-ramp"></span><span>Kırmızı</span></div>
          <span>Renkler yalnızca yüzeyin rüzgâra bakışına göre verilir. Kırmızı: rüzgâra karşı bakan yüzey. Pa / Cₚ değeri gösterilmez.</span>
        </div>
        <div class="scene-bottom">
          <div class="play-controls"><button id="play" class="button play-button">${icon("pause", 16)}<span>Duraklat</span></button><span class="slow-note">Animasyon yavaşlatılmıştır</span></div>
          <div class="camera-controls" aria-label="Kamera görünümü"><button data-view="perspective" class="view-button active">3D</button><button data-view="side" class="view-button">Yan</button><button data-view="top" class="view-button">Üst</button><button data-view="front" class="view-button">Ön</button><button id="screenshot" class="icon-button" title="Sahneyi PNG olarak indir" aria-label="Sahneyi PNG olarak indir">${icon("camera")}</button></div>
        </div>
        <div class="visual-options"><label><input data-layer="lines" type="checkbox" checked/><span>Akış çizgileri</span></label><label><input data-layer="particles" type="checkbox" checked/><span>Parçacıklar</span></label><label><input data-layer="vectors" type="checkbox"/><span>Kuvvet yönleri</span></label><label><input data-layer="wireframe" type="checkbox"/><span>Tel kafes</span></label><span class="schematic-note">Mavi: şematik yollar · Turuncu: hareket yönü · Renkler hız/basınç ölçümü değil</span></div>
      </section>

      <section class="model-section"><div class="model-section-heading"><div><span class="eyebrow">MODEL KÜTÜPHANESİ</span><h2>Bugün neyi test ediyoruz?</h2></div><span class="small-note">Bir cisim seç, koşulları değiştir.</span></div>
        <div class="model-grid">${catalog.map((m) => `<button class="model-card ${m.id === selected.id ? "selected" : ""}" data-model="${m.id}" aria-pressed="${m.id === selected.id}"><span class="model-check">${icon("check", 13)}</span><span class="model-thumb" data-thumb="${m.id}"></span><strong>${m.name}</strong><small>${m.subtitle}</small></button>`).join("")}</div>
        <div class="upload-zone" id="upload-zone"><span class="upload-icon">${icon("upload", 24)}</span><div class="upload-copy"><strong>Kendi modelini tünele getir.</strong><span>GLB, glTF, OBJ veya STL · En fazla 50 MB / 150 bin üçgen</span></div><button id="upload" class="button">Model yükle ${icon("plus", 15)}</button><input type="file" id="file-input" multiple hidden accept=".glb,.gltf,.obj,.stl,.bin,.png,.jpg,.jpeg,.webp"/></div>
        <div id="custom-model" hidden></div><p class="import-note">Dosyalar bu tarayıcıda işlenir. glTF modelini .bin ve doku dosyalarıyla birlikte seçin. OBJ, geometrisiyle yüklenir.</p>
      </section>

      <section class="experiment-section"><div class="experiment-heading"><div><span class="eyebrow">DENEY DEFTERİ</span><h2>Koşulları karşılaştır <span id="run-count">0</span></h2></div><div class="experiment-actions"><button id="export" class="button quiet" disabled>${icon("download", 16)} CSV</button><button id="record" class="button primary">${icon("plus", 16)} Deneyi kaydet</button></div></div>
        <div id="runs-empty" class="empty-state">${icon("chart", 30)}<div><strong>İlk ölçümünle başla.</strong><p>Bir sonucu kaydet; farklı hızları, açıları ve cisimleri aynı tabloda karşılaştır.</p></div></div>
        <div class="table-scroll" id="runs-table" hidden><table><thead><tr><th>Deney / cisim</th><th>Hız</th><th>α / β</th><th>Yoğunluk</th><th>Cᴅ / Cʟ</th><th>Sürükleme</th><th>Kaldırma</th><th></th></tr></thead><tbody id="runs-body"></tbody></table></div>
        <div class="notebook-footer"><span>Bu oturumdaki kayıtlar · Sayfa kapanmadan CSV indir.</span><button id="export-json" class="text-button" disabled>Tüm ayarları JSON indir ${icon("download", 13)}</button></div>
      </section>
      <footer class="page-footer"><span>Rüzgârlab <span class="mono">/ 1.0</span></span><span>Merak için tasarlandı. Öğrenmek için hesaplandı.</span></footer>
    </div>

    <aside class="sidebar right-sidebar" aria-label="Deney sonuçları"><div class="results-heading"><span class="eyebrow">ANLIK SONUÇLAR</span><span class="approx-pill">Yaklaşık</span></div>
      <div class="force-metric drag-metric"><div class="metric-title"><span>Sürükleme kuvveti</span><span class="symbol">Fᴅ ${icon("arrow", 16)}</span></div><div class="big-number"><span id="drag">—</span><span>N</span></div><svg class="metric-art" viewBox="0 0 220 32" aria-hidden="true"><path d="M0 28 Q90 27 215 3" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M0 28H220" stroke="currentColor" stroke-opacity=".15"/></svg><p>Akış yönünde etkiyen kuvvet</p></div>
      <div class="force-metric lift-metric"><div class="metric-title"><span>Kaldırma kuvveti</span><span class="symbol">Fʟ ↑</span></div><div class="big-number"><span id="lift">—</span><span>N</span></div><p>Seçili Cʟ ile hesaplanan kaldırma</p></div>
      <div class="result-list"><div><span>Dinamik basınç <small>q = ½ρV²</small></span><strong id="dynamic-pressure">—</strong></div><div><span>Reynolds sayısı <small>Re = ρVL / μ</small></span><strong id="reynolds">—</strong></div><div><span>Mach sayısı</span><strong id="mach">—</strong></div><div><span>Referans alanı <small id="reference-label">Kanat planform alanı</small></span><strong id="reference-area">—</strong></div><div><span>Karakteristik boy</span><strong id="reference-length">—</strong></div><div><span>Tıkanma oranı <small>İzdüşüm / tünel kesiti</small></span><strong id="blockage">—</strong></div></div>
      <div class="coefficients"><div><span>Cᴅ</span><strong id="result-cd">—</strong></div><div><span>Cʟ</span><strong id="result-cl">—</strong></div></div>
      <div id="warnings" aria-live="polite"></div>
      <div class="reading-note">${icon("info", 18)}<div><strong>Bu değerleri nasıl okumalı?</strong><p>Kuvvetler seçili katsayılardan hesaplanır. Çizgiler cismin çevresindeki akışı temsilen gösterir; yüzey basıncı ölçümü değildir.</p><button id="method" class="text-button">Hesaplama yöntemi ${icon("arrow", 13)}</button></div></div>
    </aside>
  </main>
  <div id="toast" role="status" aria-live="polite"></div>
  <dialog id="help-dialog"><div class="dialog-heading"><div><span class="eyebrow">DENEY KILAVUZU</span><h2>Gözlemden karşılaştırmaya.</h2></div><button id="close-help" class="icon-button" aria-label="Kılavuzu kapat">${icon("close", 22)}</button></div><div class="dialog-content">
    <p>Bir model seçin, hava koşullarını ve yönelimini değiştirin. Kamerayı fareyle döndürün veya 3D / Yan / Üst / Ön düğmelerini kullanın. Sonucu deney defterine kaydedip başka bir koşulla karşılaştırın.</p>
    <h3>Ne hesaplanıyor?</h3><div class="formula">ρ = p / (R · T)<br>q = ½ · ρ · V²<br>Fᴅ = q · A · Cᴅ &nbsp; Fʟ = q · A · Cʟ<br>Re = ρ · V · L / μ</div>
    <p>Kuru hava için R = 287,05 J/(kg·K). Basınç mutlaktır; sıcaklık Kelvin'e çevrilir. Viskozite Sutherland bağıntısıyla veya girdiğiniz değerle belirlenir. Mach sayısı kuru hava için γ = 1,4 ile hesaplanır.</p>
    <h3>Geometri ve katsayılar</h3><p>Küp, küre, inek ve araçlarda alan, döndürülmüş üçgen yüzeylerin akışa dik izdüşümünün 160 × 160 ızgarada yaklaşık birleşim alanıdır. Karakteristik boy, yönelimden önceki en uzun boyuttur. Kanatta referans alanı 1,2 × 3,6 m² planform alanıdır; karakteristik boy 1,2 m veterdir. Ölçek alanı karesiyle, boyu doğrusal değiştirir. Elle alan girerseniz o değer sabit kalır.</p>
    <p>Kanat NACA 0012 kesitli, açıklık oranı 3 olan temsili sonlu kanattır. Otomatik modda Cʟ = 2πα / (1 + 2/3), Cᴅ = 0,02 + Cʟ²/(π·3·0,8). Yalnızca |α| ≤ 12°, |β| ≤ 15° ve |yatış| ≤ 15° için kuvvet gösterilir; stall modellenmez. Kuvvet yönleri şematiktir, vektör boyları logaritmik görsel ölçek kullanır.</p>
    <p>Diğer modellerin başlangıç Cᴅ değerleri eğitim amaçlı varsayımlardır (inek 0,9; Spider 0,45; Connect 0,4; küre 0,47; küp 1,05). Bunlar belirli bir aracın ölçülmüş katsayıları değildir. Manuel katsayılar açı, Reynolds sayısı veya türbülansla otomatik değişmez; uygun veriniz varsa düzenleyin.</p>
    <h3>Görselleştirme sınırları</h3><p>Akış yolları cismin çevreleyen kutusuna göre saptırılır; ayrıntılı geometri üzerinde akış denklemi çözülmez. Renkler dekoratiftir; yerel hız veya basınç ölçeği değildir. Parçacık hareketi yavaşlatılmıştır. İz bölgesi dalgalanması yalnızca animasyona etki eder. Zemin, duvar, sıkıştırılabilirlik ve cisimler arası etkileşim çözülmez. Her deney tek cisim içindir.</p>
    <h3>Kendi modelini yükle</h3><p>GLB / glTF 2.0, OBJ ve ASCII / binary STL desteklenir. glTF'nin .bin ve dokularını birlikte seçin. OBJ malzemeleri içe aktarılmaz. Sıkıştırmalı Draco, Meshopt, KTX, iskelet animasyonu ve morph modellerini önce statik, sıkıştırmasız mesh olarak dışa aktarın. 50 MB ve 150 bin üçgen sınırı vardır.</p>
    <p>Yüklenen modelin en uzun boyutu başlangıçta <strong>1 metreye</strong> normalize edilir. Gerçek uzunluğu metre cinsinden ölçek alanına girin (ör. 4,4 m → 4,4×). Gerekirse açılarla düzeltin: yukarı +Y, hava akışı +X. Yükleme Cᴅ veya Cʟ'yi geometriden çıkarmaz; bu katsayıları siz seçersiniz.</p>
    <h3>Kaynaklar</h3><p><a href="https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/drag-equation/" target="_blank" rel="noopener">NASA — Sürükleme denklemi</a> · <a href="https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/drag-coefficient/" target="_blank" rel="noopener">NASA — Katsayı ve referans alanı</a> · <a href="https://threejs.org/docs/pages/GLTFLoader.html" target="_blank" rel="noopener">Three.js — Model yükleme</a></p>
  </div></dialog>`;

let tunnel: TunnelScene;
try {
  tunnel = new TunnelScene($("#viewport"), state);
  tunnel.setObject(selected.build());
} catch (error) {
  $("#render-error").hidden = false;
  $("#render-error").textContent =
    "3D sahne başlatılamadı. Tarayıcınızda WebGL ve donanım hızlandırmayı etkinleştirip sayfayı yenileyin.";
  throw error;
}

function referenceLabel() {
  return state.manualArea
    ? "Elle girilen alan"
    : selected.id === "wing"
      ? "Kanat planform alanı"
      : "Akışa dik izdüşüm";
}
let updateFrame = 0;
let geometryDirty = false;
function update(geometryChanged = false) {
  const geometry = tunnel.update(state, geometryChanged || geometryDirty);
  geometryDirty = false;
  currentLength =
    selected.id === "wing"
      ? 1.2 * state.scale
      : Math.max(
          geometry.originalSize.x,
          geometry.originalSize.y,
          geometry.originalSize.z,
        );
  const reference =
    selected.id === "wing" ? 4.32 * state.scale ** 2 : geometry.projectedArea;
  results = calculate(
    state,
    geometry.projectedArea,
    reference,
    currentLength,
    selected.id === "wing",
  );
  tunnel.setForces(results.drag, results.lift);
  const fields: Record<string, string> = {
    drag: number(results.drag, 1),
    lift: number(results.lift, 1),
    density: `${number(results.density, 3)} kg/m³`,
    "speed-kmh": `${number(state.speed * 3.6, 0)} km/sa`,
    "dynamic-pressure": `${number(results.dynamicPressure, 1)} Pa`,
    reynolds:
      results.reynolds === 0
        ? "0"
        : results.reynolds.toExponential(2).replace(".", ","),
    mach: number(results.mach, 3),
    "reference-area": `${number(results.area, 3)} m²`,
    "reference-length": `${number(currentLength, 2)} m`,
    blockage: `${number(results.blockage, 1)} %`,
    "result-cd": number(results.cd, 3),
    "result-cl": number(results.cl, 3),
    "reference-label": referenceLabel(),
    "dimension-label": `${number(geometry.size.x, 2)} × ${number(geometry.size.y, 2)} × ${number(geometry.size.z, 2)} m`,
    "area-note":
      selected.id === "wing"
        ? "Otomatik alan: kanadın planform alanı. Elle girilen alan ölçek değişse de sabit kalır."
        : "Otomatik alan: akışa dik geometri izdüşümü. Elle girilen alan ölçek değişse de sabit kalır.",
  };
  for (const [id, value] of Object.entries(fields))
    $(`#${id}`).textContent = value;
  const disable = (key: string, disabled: boolean) => {
    $<HTMLInputElement>(`#${key}`).disabled = disabled;
    $<HTMLInputElement>(`[data-range="${key}"]`).disabled = disabled;
    $(`#${key}`).closest(".control")?.classList.toggle("is-disabled", disabled);
  };
  disable("viscosity", state.autoViscosity);
  disable("area", !state.manualArea);
  disable("cd", selected.id === "wing" && state.autoWing);
  disable("cl", selected.id === "wing" && state.autoWing);
  $("#wing-auto-row").hidden = selected.id !== "wing";
  if (state.autoViscosity)
    $<HTMLInputElement>("#viscosity").value = results.viscosity.toPrecision(4);
  if (!state.manualArea)
    $<HTMLInputElement>("#area").value = results.area.toFixed(4);
  if (selected.id === "wing" && state.autoWing) {
    $<HTMLInputElement>("#cd").value = results.cd?.toFixed(4) ?? "";
    $<HTMLInputElement>("#cl").value = results.cl?.toFixed(4) ?? "";
  }
  const warnings: string[] = [];
  if (results.wingOutsideRange)
    warnings.push(
      "Kanat yaklaşımının açı sınırı aşıldı. |α| ≤ 12°, |β| ve |yatış| ≤ 15° olmalı veya katsayıları elle girin.",
    );
  if (results.mach > 0.3)
    warnings.push(
      "Mach > 0,3: sıkıştırılabilirlik önemli olabilir. Bu yaklaşım sıkıştırılabilirlik düzeltmesi yapmaz.",
    );
  if (
    geometry.size.y > state.tunnelHeight ||
    geometry.size.z > state.tunnelWidth ||
    geometry.size.x > state.tunnelLength
  )
    warnings.push(
      "Cisim tünel boyutlarını aşıyor. Ölçeği küçültün veya tüneli büyütün.",
    );
  else if (results.blockage > 5)
    warnings.push(
      "Tıkanma oranı %5 üzerinde. Duvar etkisi bu hesaplamaya dahil değil.",
    );
  if (state.speed === 0)
    warnings.push(
      "Rüzgâr hızı sıfır. Aerodinamik kuvvet ve akış hareketi yok.",
    );
  $("#warnings").replaceChildren(
    ...warnings.map((message) => {
      const p = document.createElement("p");
      p.className = "warning";
      p.textContent = message;
      return p;
    }),
  );
  updatePlay();
}

function syncInputs() {
  for (const input of document.querySelectorAll<HTMLInputElement>(
    "[data-key], [data-range]",
  )) {
    input.value = String(
      state[(input.dataset.key || input.dataset.range) as keyof Conditions],
    );
  }
  for (const key of ["autoViscosity", "autoWing", "manualArea"] as const)
    $<HTMLInputElement>(`#${key}`).checked = state[key];
}

for (const input of document.querySelectorAll<HTMLInputElement>(
  "[data-key], [data-range]",
)) {
  input.addEventListener("input", () => {
    const key = (input.dataset.key || input.dataset.range) as keyof Conditions;
    if (input.value === "" || !Number.isFinite(input.valueAsNumber)) return;
    const value = Math.min(
      Number(input.max),
      Math.max(Number(input.min), input.valueAsNumber),
    );
    if (input.dataset.key && value !== input.valueAsNumber) return;
    (state as unknown as Record<string, number>)[key] = value;
    const counterpart = $<HTMLInputElement>(
      input.dataset.key ? `[data-range="${key}"]` : `#${key}`,
    );
    counterpart.value = String(value);
    if (["speed", "pressure", "temperature"].includes(key))
      document
        .querySelectorAll("[data-preset]")
        .forEach((b) => b.classList.remove("active"));
    cancelAnimationFrame(updateFrame);
    geometryDirty ||= [
      "scale",
      "yaw",
      "pitch",
      "roll",
      "tunnelLength",
      "tunnelWidth",
      "tunnelHeight",
    ].includes(key);
    updateFrame = requestAnimationFrame(() => update());
  });
  input.addEventListener("change", () => {
    input.value = String(
      state[(input.dataset.key || input.dataset.range) as keyof Conditions],
    );
  });
}
for (const key of ["autoViscosity", "autoWing", "manualArea"] as const) {
  $<HTMLInputElement>(`#${key}`).addEventListener("change", (e) => {
    state[key] = (e.target as HTMLInputElement).checked;
    if (key === "manualArea" && state.manualArea) {
      state.area = Number(results.area.toFixed(4));
      syncInputs();
    }
    if (key === "autoViscosity" && !state.autoViscosity) {
      state.viscosity = results.viscosity;
      syncInputs();
    }
    if (key === "autoWing" && !state.autoWing) {
      state.cd = results.cd ?? selected.cd;
      state.cl = results.cl ?? 0;
      syncInputs();
    }
    update();
  });
}

function selectModel(spec: ModelSpec) {
  selected = spec;
  state = {
    ...state,
    scale: 1,
    pitch: spec.id === "wing" ? 6 : 0,
    yaw: 0,
    roll: 0,
    cd: spec.cd,
    cl: 0,
    manualArea: false,
    autoWing: true,
  };
  tunnel.setObject(spec.build());
  document.querySelectorAll<HTMLElement>("[data-model]").forEach((b) => {
    b.classList.toggle("selected", b.dataset.model === spec.id);
    b.setAttribute("aria-pressed", String(b.dataset.model === spec.id));
  });
  $("#scene-title").textContent = spec.name;
  const subtitle = document.createElement("span");
  subtitle.textContent = spec.subtitle;
  $("#scene-title").append(subtitle);
  $<HTMLInputElement>('[data-layer="wireframe"]').checked = false;
  tunnel.setLayer("wireframe", false);
  syncInputs();
  update(true);
}
document
  .querySelectorAll<HTMLElement>("[data-model]")
  .forEach((button) =>
    button.addEventListener("click", () =>
      selectModel(catalog.find((m) => m.id === button.dataset.model)!),
    ),
  );
document.querySelectorAll<HTMLElement>("[data-preset]").forEach((button) =>
  button.addEventListener("click", () => {
    const preset = button.dataset.preset;
    state.speed = preset === "breeze" ? 5 : preset === "strong" ? 40 : 20;
    state.pressure = defaults.pressure;
    state.temperature = defaults.temperature;
    document
      .querySelectorAll("[data-preset]")
      .forEach((b) => b.classList.toggle("active", b === button));
    syncInputs();
    update();
  }),
);
document
  .querySelectorAll<HTMLInputElement>("[data-layer]")
  .forEach((input) =>
    input.addEventListener("change", () =>
      tunnel.setLayer(input.dataset.layer!, input.checked),
    ),
  );
document.querySelectorAll<HTMLButtonElement>("[data-display]").forEach(button => {
  button.addEventListener("click", () => {
    const mode = button.dataset.display as DisplayMode;
    tunnel.setDisplayMode(mode);
    document.querySelectorAll<HTMLButtonElement>("[data-display]").forEach(b => {
      b.classList.toggle("active", b === button);
      b.setAttribute("aria-pressed", String(b === button));
    });
    $("#pressure-legend").hidden = mode === "flow";
    document.querySelectorAll<HTMLInputElement>('[data-layer="lines"], [data-layer="particles"], [data-layer="vectors"]').forEach(input => {
      input.disabled = mode === "pressure";
    });
  });
});
document.querySelectorAll<HTMLElement>("[data-view]").forEach((button) =>
  button.addEventListener("click", () => {
    tunnel.setView(button.dataset.view!);
    document
      .querySelectorAll("[data-view]")
      .forEach((b) => b.classList.toggle("active", b === button));
  }),
);
function updatePlay() {
  const running = tunnel.isRunning();
  $("#play").innerHTML =
    `${icon(running ? "pause" : "play", 16)}<span>${running ? "Duraklat" : "Akışı başlat"}</span>`;
  $("#live-badge").innerHTML =
    `<span class="status-dot"></span> ${state.speed === 0 ? "Rüzgâr yok" : running ? "Akış açık" : "Duraklatıldı"}`;
  $("#live-badge").classList.toggle("paused", !running || state.speed === 0);
}
$("#play").addEventListener("click", () => {
  tunnel.setRunning(!tunnel.isRunning());
  updatePlay();
});
$("#reset").addEventListener("click", () => {
  state = {
    ...defaults,
    cd: selected.cd,
    pitch: selected.id === "wing" ? 6 : 0,
  };
  syncInputs();
  update(true);
  tunnel.setView("perspective");
  document
    .querySelectorAll<HTMLElement>("[data-preset]")
    .forEach((b) =>
      b.classList.toggle("active", b.dataset.preset === "standard"),
    );
  document
    .querySelectorAll<HTMLElement>("[data-view]")
    .forEach((b) =>
      b.classList.toggle("active", b.dataset.view === "perspective"),
    );
  toast("Deney ayarları sıfırlandı. Defterdeki kayıtlar korundu.");
});

let toastTimeout: ReturnType<typeof setTimeout>;
function toast(message: string) {
  clearTimeout(toastTimeout);
  $("#toast").textContent = message;
  $("#toast").classList.add("show");
  toastTimeout = setTimeout(() => $("#toast").classList.remove("show"), 5500);
}
function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob),
    link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$("#screenshot").addEventListener("click", async () => {
  try {
    download(await tunnel.snapshot(), `ruzgar-lab-${selected.id}.png`);
    toast("Sahne görüntüsü indirildi.");
  } catch {
    toast("Sahne görüntüsü alınamadı. Yeniden deneyin.");
  }
});
$("#upload").addEventListener("click", () =>
  $<HTMLInputElement>("#file-input").click(),
);
async function handleFiles(files: File[]) {
  const upload = $<HTMLButtonElement>("#upload");
  upload.disabled = true;
  upload.textContent = "Yükleniyor…";
  try {
    const imported = await importModel(files);
    if (customSource) disposeObject(customSource);
    customSource = imported.group;
    const source = imported.group;
    customSpec = {
      id: "custom",
      name: imported.name,
      subtitle: "Yüklenen model · başlangıç boyu 1 m",
      cd: 0.5,
      length: 1,
      build: () => {
        const clone = source.clone(true);
        clone.traverse((o) => {
          if (o instanceof THREE.Mesh) {
            o.geometry = o.geometry.clone();
            o.material = Array.isArray(o.material)
              ? o.material.map((m) => m.clone())
              : o.material.clone();
          }
        });
        return clone;
      },
    };
    selectModel(customSpec);
    $("#custom-model").hidden = false;
    $("#custom-model").innerHTML =
      `<button class="custom-model-button selected" data-model="custom" aria-pressed="true">${icon("cube")}<strong>${escapeHtml(imported.name)}</strong><span>${number(imported.triangles, 0)} üçgen · En uzun boyut 1 m; ölçekle gerçek boyu ayarla.</span><span class="custom-check">${icon("check", 16)}</span></button>`;
    $("#custom-model button").addEventListener("click", () => {
      if (customSpec) selectModel(customSpec);
    });
    toast(
      "Model yüklendi. Gerçek boyunu ölçekten, Cᴅ ve Cʟ değerlerini katsayılardan ayarla.",
    );
  } catch (error) {
    toast(
      error instanceof Error
        ? error.message
        : "Model yüklenemedi. Dosyayı kontrol edin.",
    );
  } finally {
    upload.disabled = false;
    upload.innerHTML = `Model yükle ${icon("plus", 15)}`;
    $<HTMLInputElement>("#file-input").value = "";
  }
}
$("#file-input").addEventListener("change", (e) => {
  const files = Array.from((e.target as HTMLInputElement).files || []);
  if (files.length) void handleFiles(files);
});
$("#upload-zone").addEventListener("dragover", (e) => {
  e.preventDefault();
  $("#upload-zone").classList.add("dragging");
});
$("#upload-zone").addEventListener("dragleave", () =>
  $("#upload-zone").classList.remove("dragging"),
);
$("#upload-zone").addEventListener("drop", (e) => {
  e.preventDefault();
  $("#upload-zone").classList.remove("dragging");
  if (!$<HTMLButtonElement>("#upload").disabled)
    void handleFiles(Array.from((e as DragEvent).dataTransfer?.files || []));
});

function renderRuns() {
  $("#run-count").textContent = String(runs.length);
  $("#runs-empty").hidden = runs.length > 0;
  $("#runs-table").hidden = runs.length === 0;
  $<HTMLButtonElement>("#export").disabled = runs.length === 0;
  $<HTMLButtonElement>("#export-json").disabled = runs.length === 0;
  $("#runs-body").innerHTML = runs
    .map(
      (run) =>
        `<tr><td><span class="run-id">${String(run.id).padStart(2, "0")}</span><strong>${escapeHtml(run.name)}</strong></td><td>${number(run.state.speed, 1)} <small>m/s</small></td><td>${run.state.pitch}° / ${run.state.yaw}°</td><td>${number(run.results.density, 3)}</td><td>${number(run.results.cd, 3)} / ${number(run.results.cl, 3)}</td><td class="drag-cell">${number(run.results.drag, 1)} N</td><td>${number(run.results.lift, 1)} N</td><td><button class="icon-button delete-run" data-run="${run.id}" aria-label="Deney ${run.id} kaydını kaldır">${icon("close", 13)}</button></td></tr>`,
    )
    .join("");
  document.querySelectorAll<HTMLElement>(".delete-run").forEach((button) =>
    button.addEventListener("click", () => {
      runs = runs.filter((r) => r.id !== Number(button.dataset.run));
      renderRuns();
    }),
  );
}
$("#record").addEventListener("click", () => {
  update();
  runs.push({
    id: ++runId,
    date: new Date().toISOString(),
    name: selected.name,
    modelId: selected.id,
    state: { ...state },
    results: { ...results },
    reference: referenceLabel(),
    length: currentLength,
  });
  renderRuns();
  toast(
    `Deney ${runId} kaydedildi. Koşulları değiştirerek karşılaştırabilirsin.`,
  );
});
const csvCell = (value: unknown) => {
  const text = String(value ?? "");
  return `"${(/^[=+\-@]/.test(text) && typeof value === "string" ? "'" : "") + text.replace(/"/g, '""')}"`;
};
$("#export").addEventListener("click", () => {
  const stateKeys = Object.keys(defaults) as (keyof Conditions)[];
  const resultKeys = [
    "density",
    "viscosity",
    "dynamicPressure",
    "area",
    "cd",
    "cl",
    "drag",
    "lift",
    "reynolds",
    "mach",
    "blockage",
    "wingOutsideRange",
  ] as const;
  const rows: unknown[][] = [
    [
      "id",
      "date_UTC",
      "model",
      "model_id",
      "reference_area_method",
      "length_m",
      ...stateKeys.map((k) => `input_${k}`),
      ...resultKeys.map((k) => `result_${k}`),
      "method",
    ],
    ...runs.map((r) => [
      r.id,
      r.date,
      r.name,
      r.modelId,
      r.reference,
      r.length,
      ...stateKeys.map((k) => r.state[k]),
      ...resultKeys.map((k) => r.results[k]),
      "Educational estimate; not CFD. SI units except temperature C, angles deg, blockage %, scale ratio.",
    ]),
  ];
  download(
    new Blob(
      ["\uFEFF" + rows.map((row) => row.map(csvCell).join(";")).join("\r\n")],
      { type: "text/csv;charset=utf-8" },
    ),
    "ruzgar-lab-deneyler.csv",
  );
});
$("#export-json").addEventListener("click", () =>
  download(
    new Blob(
      [
        JSON.stringify(
          {
            version: 1,
            method: "Educational coefficient-based estimate; not CFD",
            units: "SI; temperature Celsius; angles degrees; blockage percent",
            runs,
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    ),
    "ruzgar-lab-deneyler.json",
  ),
);
for (const id of ["help", "method"])
  $(`#${id}`).addEventListener("click", () =>
    $<HTMLDialogElement>("#help-dialog").showModal(),
  );
$("#close-help").addEventListener("click", () =>
  $<HTMLDialogElement>("#help-dialog").close(),
);
$("#help-dialog").addEventListener("click", (e) => {
  if (e.target === $("#help-dialog"))
    $<HTMLDialogElement>("#help-dialog").close();
});

function renderThumbnails() {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(220, 130);
  renderer.setPixelRatio(1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.3;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight("#ffffff", "#adbfc7", 3));
  const light = new THREE.DirectionalLight("#ffffff", 3);
  light.position.set(-4, 6, 5);
  scene.add(light);
  const camera = new THREE.PerspectiveCamera(36, 220 / 130, 0.01, 100);
  for (const spec of catalog) {
    const group = centerModel(spec.build());
    const size = new THREE.Box3()
      .setFromObject(group)
      .getSize(new THREE.Vector3());
    const length = Math.max(size.x, size.y, size.z);
    camera.position.set(-length * 1.25, length * 0.7, length * 1.5);
    camera.lookAt(0, 0, 0);
    scene.add(group);
    renderer.render(scene, camera);
    const img = document.createElement("img");
    img.src = renderer.domElement.toDataURL();
    img.alt = "";
    img.width = 220;
    img.height = 130;
    $(`[data-thumb="${spec.id}"]`).append(img);
    scene.remove(group);
    disposeObject(group);
  }
  renderer.dispose();
  renderer.forceContextLoss();
}
update(true);
requestAnimationFrame(renderThumbnails);
window.addEventListener("beforeunload", () => {
  tunnel.dispose();
  if (customSource) disposeObject(customSource);
});
