# FieldShift jüri demosu

## 90 saniyelik akış

1. Çumra harita noktasını açın. Önceki ürün olarak **Chickpea**, sulama için **Yes** seçin ve pH’ı boş bırakın. Çiftçinin ilk hasadı en geç **Temmuz 2027** istediğini söyleyin. **340 m³/da** değerini örnek sezonluk net kota olarak girin. İsterseniz mevcut plan örneği olarak buğday → nadas → buğday ekleyin.
2. İlk hasat sınırının aday havuzunu nasıl daralttığını gösterin. **Dry-year replay** altında 2025’in aylık NASA POWER verisiyle aynı kuralların yeniden çalıştığını gösterin. Kota, her ürün sezonunda kök bölgesine ulaşabilen net suyu temsil eder.
3. **Calendar-only benchmark** bölümünde iki planı yan yana açın. Takvim yöntemi ilk hasat ve bitişi öne alır. FieldShift seçeneği daha fazla model puanı alır ve daha yüksek su tahmini taşır. Kotayı **310** yapıp lider sıranın değiştiğini, **300** yapıp öneri kalmadığını gösterin.
4. Kotayı tekrar **340 m³/da** yapın ve diğer tüm Çumra girdileri sabitken **yalnızca tek bir yerel toprak girdisini** değiştirin: **Effective root-zone depth** alanına **50 cm** (sığ kaliş tabakası) girin. **Local soil, field parcel & NASA POWER decision chain** panelinde kış yağışını toprakta depolama sınırının 130 mm’den 65 mm’ye düştüğünü, baharlık nohudun kök bölgesi sulama ihtiyacının 340 m³/da kotasını aştığını ve lider planın **Mercimek → buğday → nohut** yerine kış yağışını sezon içinde kullanan **Mercimek → arpa → buğday** planına geçtiğini gösterin. Aynı panelde NASA POWER `T2M` ve `PRECTOTCORR` verisinin ve çizilen parsel alanının (dekar) karar zincirindeki yerini ve **Soil health** tablosunda mevcut rotasyonla aile tekrarı / ana ürünsüz ay farkını gösterin.
5. **Published field evidence** bölümünde parametreleri belirleyen saha çalışmalarıyla ayrı tutarlılık kontrollerini gösterin. Gerçek üretici denemesi için [etki pilotu](impact-pilot.md) akışını kullanın.

## Referans çalıştırma

14 Kasım 2026, Çumra, önceki ürün nohut, sulama mevcut ve pH boş. Aralık 2026 planlama başlangıcıyla Temmuz 2027 sınırına 120 adaydan 20’si uydu. NASA POWER 2021–2025 serisinde en az yağışlı tam yıl 2025’ti. Grid tahmini 347,3 mm, beş tam yılın medyanı 527,9 mm idi.

| Sezonluk kota | İki çalıştırmada da kotaya uyan | En yüksek puanlı kalan plan |
|---|---:|---|
| 340 m³/da | 6 | Mercimek → buğday → nohut |
| 310 m³/da | 2 | Mercimek → arpa → buğday |
| 300 m³/da | 0 | En düşük modellenen kota 308,89 m³/da |

340 m³/da örneğinde takvim yönteminin planı 32 ay sürüyor ve tarihsel modelde 77,8 puan alıyor. FieldShift planı 33 ay sürüyor ve 82,3 puan alıyor. Kurak yıl tekrarında en çok su isteyen sezonun tahmini sırasıyla 308,89 ve 313,20 m³/da. İki planın ilk hasadı da Temmuz 2027. Sayılar koordinat, tarih ve profil varsayımlarıyla birlikte okunmalı.

Bu akış, hasat hedefi ile sulama kotasının öneriyi nasıl değiştirdiğini gösterir. Sıralama puanı model çıktısı, su miktarı net kök bölgesi tahmini, 2025 koşulları ise geçmişten yeniden oynatılan tek bir örnektir. Çiftçi benimsemesi, ölçülen su kullanımı ve ekonomik sonuçlar saha pilotuyla belirlenir.

Tarla bazlı rotasyon ve su tahsisi birlikte daha önce çalışıldı. FieldShift’in gösterdiği katkı, üreticinin kendi hasat sınırını ve sezonluk kotasını değiştirdiğinde önerinin neden değiştiğini NASA POWER verisiyle yerel bir örnekte izleyebilmesidir. [Arazi ve su tahsisi üzerine çok yıllı rotasyon çalışması](https://www.sciencedirect.com/science/article/pii/S0378377425002197)
