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
npm run preview -- --base /ruzgar-lab/
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

Bu uygulama viskoz Navier–Stokes çözmez. Kuvvetler `F = 0.5 × ρ × V² × A × C` bağıntısıyla, seçilen katsayılarla bulunur. Kuru hava yoğunluğu ideal gaz bağıntısıyla, viskozite Sutherland bağıntısıyla hesaplanır. Manuel viskozite Re değerini değiştirir; katsayıları otomatik değiştirmez.

Akış çizgileri artık kutu etrafına çizilmiş eğriler değildir. Döndürülmüş gerçek üçgenler, cisim çevresinde sıklaşan 3D hücre ağına aktarılır. Kapalı hacimler ve üçgenlerle kesişen hücreler katıdır; ayrı meshler birleşim olarak işlenir. Açık yüzeylerde güvenilir iç hacim varsayılmaz, yalnızca yüzey hücreleri engel sayılır. Konservatif raster nedeniyle küçük ayrıntılar yaklaşık bir hücre kalınlaşabilir.

`u = ∇(x + ψ)` ve `∇·u = 0` için sonlu hacim Laplace sistemi çözülür. Cisim ve tünelin yan yüzeylerinde normal akı sıfırdır; bu bir **kayma** sınırıdır, viskoz no-slip değildir. Giriş/çıkışta `ψ = 0`; çözüm daha sonra seçilen ortalama giriş hızına ölçeklenir. Çözüm eksik Cholesky IC(0) önkoşullu eşlenik gradyanla, göreli artık hedefi `1e-6` olacak şekilde bulunur. `1e-5` üzerinde artık, tünele sığmayan cisim veya kapalı akış yolu durumunda çizgiler gösterilmez ve açıklama görünür. Ağdaki doğruluk bu cebirsel artıkla aynı şey değildir.

Akım çizgileri yüz akılarını koruyan RT0 hız yeniden kurulumundan, uyarlamalı orta nokta adımlarıyla izlenir. Çizgi segmentlerinin katı hücrelere girmediği kontrol edilir; eğri yumuşatmasıyla köşeler kesilmez. Parçacıklar aynı izleme sürelerini kullanır ve yerel hızla **0,16×** yavaşlatılmış hareket eder. Yapay sinüs dalgalanması kaldırılmıştır. Yan/üst görünüm tek bir başlangıç düzleminin çizgilerini, 3D görünüm üç başlangıç düzlemini gösterir; asimetrik geometride izler düzlem dışına çıkabilir. Hesap Web Worker'da çalışır; geometri değiştirilince eski hesap iptal edilir ve eski çizgiler temizlenir.

Bu hâlâ **viskozitesiz, sıkıştırılamaz, dönüsüz ideal akış** modelidir. Sınır tabaka, ayrılma, girdap izi, türbülans, stall ve sıkıştırılabilirlik çözülmez. Kanatta dolaşım/Kutta koşulu yoktur; bu nedenle kaldırmayı üreten gerçek kanat akışı değildir. Katsayılarla hesaplanan kuvvetler bu hız alanından türetilmez; kuvvet hesabına duvar etkisi eklenmez. Basınç renkleri yalnızca yüzey yöneliminden gelir, hesaplanan Pa/Cₚ değerleri değildir.

Akış kaynakları: [MIT — Potansiyel akış sınır koşulları](https://web.mit.edu/fluids-modules/www/potential_flows/LecturesHTML/lec1011/node1.html), [MIT — Küre etrafında analitik ideal akış](https://web.mit.edu/fluids-modules/www/potential_flows/LecturesHTML/lec1011/node35.html), [NASA — Sınır tabaka ve ayrılma](https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/boundary-layer/).

Kanat dışındaki modellerde otomatik referans alanı, döndürülmüş geometri yüzeylerinin yz izdüşüm birleşimidir; 160×160 raster yaklaşımı kullanır. Örtüşen yüzler iki kez sayılmaz. Karakteristik boy, yönelimden önceki en uzun boyuttur. Kanatta alan `4.32 × ölçek²` m², boy `1.2 × ölçek` m'dir. Elle girilen alan ölçekten bağımsız sabit kalır.

Kanat NACA 0012'nin kapalı firar kenarlı yaklaşımıdır. Otomatik katsayılar `CL = 2πα/(1+2/3)`, `CD = 0.02 + CL²/(π×3×0.8)`; α radyandır. AR=3 ve e=0,8 varsayılır. Otomatik sonuçlar yalnızca |α|≤12°, |β|≤15°, |yatış|≤15° için verilir. Bu sınırlar deneysel stall tahmini değildir; eğitim modelinin kullanım sınırıdır.

İnek ve araçların Cᴅ başlangıç değerleri eğitim amaçlı örnek varsayımlardır; belirli nesnelerin ölçülmüş değerleri değildir. Kürenin sabit katsayısı da tüm Reynolds aralığı için geçerli kabul edilmemelidir. Katsayıların açı, Reynolds ve yüzey koşullarına bağlı değişimi otomatik modellenmez.

Kaynaklar: [NASA sürükleme denklemi](https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/drag-equation/), [NASA referans alanı ve katsayı](https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/drag-coefficient/), [NASA indüklenmiş sürükleme](https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/induced-drag-coefficient/), [Three.js GLTFLoader](https://threejs.org/docs/pages/GLTFLoader.html), [OBJLoader](https://threejs.org/docs/pages/OBJLoader.html), [STLLoader](https://threejs.org/docs/pages/STLLoader.html).

## Doğrulama

`npm test` fizik bağıntılarını, sıfır hız durumunu, açı sınırlarını ve gerçek üçgen geometrisinin izdüşüm alanını kontrol eder. Akış testleri ayrıca boş tüneli, kesitler arası debi korunumunu, katı yüzlerde sıfır normal hızı, küre simetrisini, analitik küre alanını (yüzeyden uzaktaki örnek noktalar), çizgi güvenliğini, farklı geometrileri ve döndürülmüş ince kanadı sınar.

Uygulama 5173 portunda açıkken:

```sh
uv run --with playwright python scripts/browser_smoke.py
```

Bu script mevcut test Chromium'unu ayrı ve geçici bir profilde kullanır. Başka makinede `scripts/browser_smoke.py` içindeki `executable_path` değerini kurulu test Chromium'una göre değiştirin. Test, kendi küçük model dosyalarını üretir; altı hazır model, beş yükleme yolu, geçersiz dosya, katsayılar, duraklatma, gerçek indirmeler ve mobil taşma kontrolünü kapsar. Sonuçlar ve ekran görüntüleri git dışında kalan `artifacts/` dizinine yazılır.

## Dosyalar

- `src/main.ts`: Türkçe arayüz, kontroller, kayıt ve dışa aktarım.
- `src/scene.ts`: Three.js sahnesi, kamera, hesaplanmış çizgiler ve animasyon.
- `src/flow-geometry.ts`: Üçgenlerin konservatif 3D rasteri ve cisim yakınında sıklaşan ağ.
- `src/flow-field.ts`: Potansiyel akış çözümü, akı koruyan hız alanı ve çizgi izleme.
- `src/flow.worker.ts`: Arka plan hesabı ve başlangıç düzlemleri.
- `src/flow-field.test.ts`: Analitik referans ve akış regresyonları.
- `src/models.ts`: Hazır modeller ve izdüşüm alanı hesaplaması.
- `src/import-model.ts`: Dosya okuyucuları ve geometri doğrulaması.
- `src/physics.ts`: Birimlerden bağımsız arayüzü olan SI hesaplama çekirdeği.
- `src/physics.test.ts`: Fizik ve geometri regresyonları.
