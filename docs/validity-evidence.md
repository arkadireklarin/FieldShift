# FieldShift geçerlilik kanıtı

## Eleştiri ve yapılan düzeltme

| Eleştiri | Şimdiki davranış |
|---|---|
| Su açığı yalnızca uyarıydı | Sulamasız tarlada beklenen verim, susuz kalmayan verimin %40'ının altındaysa ürün planlara giremez. |
| Eksik iklim göstergesi puanı yükseltebiliyordu | Sıcaklık ve yağışın her biri için beklenen sezonların en az yarısı tam olmalı. Aksi halde ürün puanlanmaz. |
| Melbourne için İç Anadolu takvimi dönüyordu | Pilot sınırı dışındaki noktalar yalnızca NASA POWER iklim geçmişini alır. Puan ve plan üretilmez. |
| Sıralama saha sonuçlarıyla karşılaştırılmamıştı | Model, yayımlanmış dört saha denemesinin on bir sonucuyla her istekte yeniden karşılaştırılır. Beşi parametreleri belirlemeyen sonuçlardır. |
| Maliyet değerlendirilmemişti | Arayüzde üreticinin kendi rakamlarıyla brüt marj hesabı var. İşletim maliyeti aşağıda. |

## Su dengesi ve yerel toprak girdileri

Sezonluk su arzı, sezon içi yağış ile ekim öncesi aylardan toprağa taşınan sudur. Taşınan su, ekim öncesi yağışın %60'ı kadardır. Yerel toprak tekstürü ve kök bölgesi derinliği girilmezse üst sınır 130 mm olarak alınır (iki Konya denemesinde sulanmayan parsellerin topraktan çektiği ~128 mm su). Üretici yerel toprak bilgisini girdiğinde sezon öncesi depolama üst sınırı `tekstür kapasitesi (mm/m) × min(tarla kök derinliği, ürün maksimum kök derinliği)` bağıntısıyla hesaplanır ([FAO-56 çizelge 19 ve 22](https://www.fao.org/4/x0490e/x0490e0e.htm)):

| Toprak tekstürü | Su tutma kapasitesi | FAO-56 çizelge 19 aralığı |
|---|---:|---|
| Kaba (`coarse`, kumlu / tınlı kum) | 90 mm/m | 60–120 mm/m |
| Orta (`medium`, tınlı / siltli tın) | 130 mm/m | 110–180 mm/m (Konya referansı) |
| İnce (`fine`, killi tın / killi) | 170 mm/m | 150–230 mm/m |

Kışlık tahıllar (buğday, arpa) Ekim–Temmuz arasında yetiştiği için NASA POWER kış yağışını sezon içinde doğrudan kullanır; baharlık ürünler (mercimek, nohut, ayçiçeği, mısır) ise kış yağışının ekim öncesinde kök bölgesinde depolanmasına bağımlıdır. Bu nedenle sığ bir kaliş/sert katman (ör. 50 cm kök derinliği → 65 mm depolama sınırı) veya kaba bünyeli toprak (90 mm/m) baharlık ürünlerin depolanan suyunu düşürüp sulama ihtiyacını artırırken kışlık tahılların su dengesini korur.

## Toprak sağlığı ve parsel–ızgara rolü

- **Harita parseli ve NASA POWER ızgarası:** Seçilen nokta, çevresindeki 0,5° × 0,625° NASA POWER ızgara hücresinden günlük sıcaklık (`T2M`) ve yağış (`PRECTOTCORR`) serisini sorgular. Çizilen parsel sınırı ise tarlanın jeodezik alanını (dekar, `da`) hesaplayarak dekar başına su kotasını (`m³/da`) ve brüt marjı (`TL/da`) tüm tarla toplamına ölçekler; aynı ızgara hücresi içindeki tarlalar arasındaki farkı yerel toprak girdileri (tekstür, kök derinliği, pH) belirler.
- **Aile tekrarı ve ana ürünsüz süre:** `soilHealth` çıktısı mevcut rotasyon (ör. buğday → nadas → buğday) ile önerilen planları botanik aile tekrarı, aynı ürün tekrarı, baklagil → tahıl geçişi ve ana ürünsüz aylar (nadas + ekim arası boşluk) üzerinden karşılaştırır. Takvim çıktısı tek başına toprak örtüsü, organik madde artışı veya bakiye azot kanıtı sayılmaz; bu iddialar için sırasıyla tarla içi bitki örtüsü/anız gözlemi, aynı derinlik ve mevsimde çok yıllı laboratuvar organik madde analizi ve ekim öncesi mineral azot testi şarttır.

Beklenen verim payı FAO-33 bağıntısıyla hesaplanır: `1 − Ky × (1 − arz / tam su ihtiyacı)`. Tam su ihtiyacı ürün profilindeki üst değerdir.

| Ürün | Ky | Kaynak |
|---|---:|---|
| Nohut | 0,85 | Konya denemesi, Tarı ve Bahçeci (2022) |
| Ayçiçeği | 1,02 | Konya denemesi, Gündüz ve ark. (2018) |
| Buğday | 1,05 | FAO-56, çizelge 24 |
| Mısır | 1,25 | FAO-56, çizelge 24 |
| Arpa | 1,05 | FAO-56'da yok. Kışlık buğday değeri kullanıldı. |
| Mercimek | 1,15 | FAO-56'da yok. Bezelye değeri kullanıldı. |

## Saha sonuçlarıyla karşılaştırma

Konya merkez ve Ankara için NASA POWER 2021–2025 kayıtları kullanıldı. Denemeler başka yıllarda yapıldı, bu yüzden karşılaştırma iklim ortalamaları arasındadır.

| Kontrol | Saha | Model |
|---|---|---|
| Sulanmayan nohudun su tüketimi | 241 mm | 250 mm |
| Sulanmayan nohut verimi, tam sulamaya oranla | %48 | %53 |
| Nohutta tam sulama suyu | 333 mm | 310 mm |
| Ayçiçeğinin yağış ve topraktan su tüketimi | 235 mm | 226 mm |
| Ayçiçeği kontrol parseli verimi, tam sulamaya oranla | %53 | %50 |
| Ayçiçeğinde tam sulama suyu | 447 mm | 424 mm |
| Ayçiçeği su tüketimi, yalnızca nohut denemesinin toprak ayarıyla | 235 mm | 232 mm |
| Nohut su tüketimi, yalnızca ayçiçeği denemesinin toprak ayarıyla | 241 mm | 244 mm |
| Ankara'da susuz buğday verimi, tam sulamaya oranla | %60 | %56 |
| Kuru koşulda buğday yetişir | 1320–2243 kg/ha | Uygun, %47 verim payı |
| Buğday başka üründen sonra daha iyi | 1320–2243 kg/ha, üst üste buğdayda 543 kg/ha | Geçiş puanı 70–100, buğday üstüne buğday 5 |

İlk altı satır, parametreleri belirleyen iki Konya denemesinden gelir ve kalibrasyon kontrolüdür. Sonraki iki satırda toprak suyu ayarı tek bir denemeden alınır ve öteki denemenin sonucu tahmin edilir. Son üç satır hiçbir parametreyi belirlemeyen denemelerden gelir: Ankara'da dört sezonluk buğday denemesi [Ilbeyi ve ark. (2006)](https://doi.org/10.1016/j.agwat.2005.08.005) ve 21 yıllık rotasyon denemesi [Cayci ve ark. (2009)](https://doi.org/10.1016/j.still.2008.09.004). Diğer kaynaklar: [Tarı ve Bahçeci (2022)](https://doi.org/10.15316/SJAFS.2022.020), [Gündüz ve ark. (2018)](https://dergipark.org.tr/tr/download/article-file/595097), [FAO-56](https://www.fao.org/4/x0490e/x0490e0e.htm). Kontroller `src/lib/validation/evidence.test.ts` içinde test olarak çalışır.

## Çiftçi maliyeti

**Costs and returns** bölümü mevcut rotasyonu ve öne çıkan planları dekar başına brüt marjla karşılaştırır. Üretici her ürün için beklenen verimi, satış fiyatını ve sulama suyu dışındaki üretim maliyetini girer. Alanlar boş başlar, çünkü fiyatlar ve girdi maliyetleri her sezon değişir.

Sulu tarlada pompalanan su, modelin kök bölgesi sulama ihtiyacının sulama sisteminin randımanına bölünmesiyle bulunur. Randımanlar FAO'nun gösterge değerleridir: yüzey %60, yağmurlama %75, damla %90. [FAO sulama randımanları](https://www.fao.org/4/t7202e/t7202e08.htm)

Brüt marj, üç döngünün gelirinden üretim ve sulama maliyetinin çıkarılmasıdır. Yıllık değer, farklı uzunluktaki planları karşılaştırmak için plan süresine bölünür.

## İşletim maliyeti

- **İklim verisi.** NASA POWER ücretsizdir ve API anahtarı gerektirmez.
- **Barındırma.** Vercel Hobby planı aylık 0 dolardır ve ayda 1 milyon fonksiyon çağrısı içerir. Pro plan aylık 20 dolardır. Her analiz bir çağrıdır. Ticari kullanım için plan koşulları kontrol edilmelidir. [Vercel fiyatları](https://vercel.com/pricing)
- **Veri saklama.** Hesap, veritabanı veya kişisel veri yoktur. Pilot yanıtları ve bütçe girdileri tarayıcıda kalır.
- **Harita.** Esri ve OpenStreetMap karo sunucuları kullanılır. Yaygın kullanımda ücretli bir karo planı gerekebilir. Bu kalemin fiyatı henüz belirlenmedi.
- **Bakım.** Yılda bir kez iklim penceresi güncellenir, kanıt testleri çalıştırılır ve ürün profilleri bir ziraat mühendisiyle gözden geçirilir.
- **Pilot.** [Etki pilotu](impact-pilot.md) 5–10 üreticiyle 15 dakikalık oturumlar öngörür. Saha ölçümlerinin bütçesi henüz çıkarılmadı.

## Açık kalanlar

- Sıralanan planlar üretici tarlasında henüz denenmedi. Verim, su ve marj ölçümü pilotla yapılacak.
- Arpa ve mercimek için Ky değerleri benzer ürünlerden alındı.
- %40 eşiği ve toprak suyu katsayıları iki Konya denemesine göre ayarlandı ve bölgenin tamamında sınanmadı.
- NASA POWER yağışı ızgara hücresi tahminidir. Çumra hücresi yılda 484 mm, Konya merkez hücresi 330 mm verir. Yerel istasyon verisiyle karşılaştırılmalıdır.
- Model yalnızca İç Anadolu pilot sınırı içinde çalışır.
