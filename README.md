# Rüzgâr Lab

Eğitim amaçlı, tarayıcıda çalışan 3D rüzgâr tüneli. Türkçe arayüz, TypeScript, Three.js ve Vite kullanır. Hesaplama sunucusu veya API anahtarı gerektirmez.

## Başlatma

```sh
npm ci
npm run dev -- --port 5173 --strictPort
```

Tarayıcı: http://127.0.0.1:5173/

```sh
npm test
npm run build
npm run preview
```

Üretim çıktısı `dist/` dizinindedir. Geliştirme sunucusu yalnızca `127.0.0.1` üzerinde dinler; otomatik açılış servisi kurulmaz.

## Deney

- NACA 0012 profilli sonlu kanat, inek, klasik Fiat 124 Spider, küre, küp ve Ford Connect hazırdır. Araçlar ve inek uygulama içinde oluşturulan temsili geometrilerdir; üretici CAD verisi değildir.
- Hız, mutlak basınç, sıcaklık, viskozite, ölçek, hücum/yatay/yatış açıları, katsayılar, referans alanı ve tünel boyutları değiştirilebilir.
- Yoğunluk, dinamik basınç, sürükleme/kaldırma kuvvetleri, Reynolds, Mach ve tıkanma oranı hesaplanır.
- Kamerayı fareyle döndürün, tekerlekle yakınlaştırın. Klavyeyle erişilebilen dört görünüm düğmesi bulunur.
- Akış çizgileri, parçacıklar, kuvvet yönleri ve tel kafes açılıp kapatılabilir. Azaltılmış hareket tercihi varsa animasyon duraklatılmış başlar.
- Her kayıt o andaki cismi, girdileri ve sonuçları saklar. CSV veya JSON tüm ayarları içerir. Kayıtlar bellektedir; sayfayı kapatmadan indirin. PNG düğmesi 3D sahneyi indirir.

## Model yükleme

Sıkıştırmasız GLB / glTF 2.0, OBJ, ASCII veya binary STL. En fazla toplam 50 MB ve 150.000 üçgen. Dosyalar yerel tarayıcıda işlenir; sunucuya yüklenmez.

glTF dosyasını bağlı `.bin` ve doku dosyalarıyla birlikte seçin. Dış kaynaktan model bağımlılığı indirilmez. OBJ yalnızca geometrisiyle yüklenir. Draco, Meshopt ve KTX sıkıştırmaları, skinned/instanced/morph modelleri için önce statik ve sıkıştırmasız dışa aktarım gerekir.

Yüklenen modelin en uzun boyutu **1 metreye normalize edilir**. Örneğin gerçek uzunluk 4,4 metre ise ölçeği 4,4× yapın. Yukarı +Y, akış +X yönündedir. İçe aktarılan geometri kendi Cᴅ/Cʟ katsayılarını üretmez; bunları ayarlayın. Bir özel model tutulur; yeni yükleme bu özel modelin yerini alır. Eski deney kayıtları korunur.

## Hesaplama sınırları

Bu uygulama CFD çözmez. Kuvvetler `F = 0.5 × ρ × V² × A × C` bağıntısıyla, seçilen katsayılarla bulunur. Kuru hava yoğunluğu ideal gaz bağıntısıyla, viskozite Sutherland bağıntısıyla hesaplanır. Manuel viskozite Re değerini değiştirir; katsayıları otomatik değiştirmez.

Akış çizgileri cismin çevreleyen kutusuna göre saptırılan şematik yollardır. Renkler yerel hız/basınç verisi değildir. Parçacıklar yavaşlatılmış gösterilir. İz dalgalanması yalnızca animasyona etki eder. Yüzey basıncı, stall, duvar/zemin etkileri, sıkıştırılabilir akış veya cisimler arası etkileşim çözülmez. Her deney bir cisim içindir.

Kanat dışındaki modellerde otomatik referans alanı, döndürülmüş geometri yüzeylerinin yz izdüşüm birleşimidir; 160×160 raster yaklaşımı kullanır. Örtüşen yüzler iki kez sayılmaz. Karakteristik boy, yönelimden önceki en uzun boyuttur. Kanatta alan `4.32 × ölçek²` m², boy `1.2 × ölçek` m'dir. Elle girilen alan ölçekten bağımsız sabit kalır.

Kanat NACA 0012'nin kapalı firar kenarlı yaklaşımıdır. Otomatik katsayılar `CL = 2πα/(1+2/3)`, `CD = 0.02 + CL²/(π×3×0.8)`; α radyandır. AR=3 ve e=0,8 varsayılır. Otomatik sonuçlar yalnızca |α|≤12°, |β|≤15°, |yatış|≤15° için verilir. Bu sınırlar deneysel stall tahmini değildir; eğitim modelinin kullanım sınırıdır.

İnek ve araçların Cᴅ başlangıç değerleri eğitim amaçlı örnek varsayımlardır; belirli nesnelerin ölçülmüş değerleri değildir. Kürenin sabit katsayısı da tüm Reynolds aralığı için geçerli kabul edilmemelidir. Katsayıların açı, Reynolds ve yüzey koşullarına bağlı değişimi otomatik modellenmez.

Kaynaklar: [NASA sürükleme denklemi](https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/drag-equation/), [NASA referans alanı ve katsayı](https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/drag-coefficient/), [NASA indüklenmiş sürükleme](https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/induced-drag-coefficient/), [Three.js GLTFLoader](https://threejs.org/docs/pages/GLTFLoader.html), [OBJLoader](https://threejs.org/docs/pages/OBJLoader.html), [STLLoader](https://threejs.org/docs/pages/STLLoader.html).

## Doğrulama

`npm test` fizik bağıntılarını, sıfır hız durumunu, açı sınırlarını ve gerçek üçgen geometrisinin izdüşüm alanını kontrol eder.

Uygulama 5173 portunda açıkken:

```sh
uv run --with playwright python scripts/browser_smoke.py
```

Bu script mevcut test Chromium'unu ayrı ve geçici bir profilde kullanır. Başka makinede `scripts/browser_smoke.py` içindeki `executable_path` değerini kurulu test Chromium'una göre değiştirin. Test, kendi küçük model dosyalarını üretir; altı hazır model, beş yükleme yolu, geçersiz dosya, katsayılar, duraklatma, gerçek indirmeler ve mobil taşma kontrolünü kapsar. Sonuçlar ve ekran görüntüleri git dışında kalan `artifacts/` dizinine yazılır.

## Dosyalar

- `src/main.ts`: Türkçe arayüz, kontroller, kayıt ve dışa aktarım.
- `src/scene.ts`: Three.js sahnesi, kamera, şematik akış ve animasyon.
- `src/models.ts`: Hazır modeller ve izdüşüm alanı hesaplaması.
- `src/import-model.ts`: Dosya okuyucuları ve geometri doğrulaması.
- `src/physics.ts`: Birimlerden bağımsız arayüzü olan SI hesaplama çekirdeği.
- `src/physics.test.ts`: Fizik ve geometri regresyonları.
