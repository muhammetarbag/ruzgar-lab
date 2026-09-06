# Tarayıcı regresyon kontrolü

`browser_regression.py` bağımsız Chromium oturumunda çalışır. Soyağacı testleri yalnızca geçici tarayıcı profilindeki yapay kayıtları değiştirir.

Siteyi mevcut yayın alt yolu ile yerel olarak servis edin; ardından:

```sh
uv run --with playwright python tests/browser_regression.py --base http://127.0.0.1:3137
```

Farklı Chromium konumu için `--chromium /tam/yol/chromium` kullanın. Ekran görüntüleri ve sonuçlar `/tmp/ruzgar-lab-browser-checks` altında oluşturulur. 320, 390, 768 ve 1440 piksel genişlikler kontrol edilir.

Akış regresyonları altı modelin Web Worker hesabının yakınsamasını, hızlı model değişiminde eski hesabın iptalini, tüneli aşan geometride açık hatayı ve ardından toparlanmayı da denetler. Sayısal alan/analitik referans testleri `npm test` içindedir.
