# FieldShift jüri demosu

Ankara yerel etkinliğindeki canlı anlatım için. Gönderim sayfası ve demo materyali İngilizce olmak zorunda; onlar [submission.md](submission.md) içinde.

Aşağıdaki sayılar tek bir canlı çalıştırmadan alındı: Çumra (37,5667° K, 32,7750° D), son ürün buğday, sulama yok, mevcut plan buğday → nadas → buğday. Planlama Aralık 2026'da başlıyor.

## 2–3 dakikalık akış

1. **Sorun (20 sn).** "Konya'da yaygın bir düzen var: buğday, nadas, buğday. Yeraltı suyu düşüyor. Çiftçiye 'bütün planını değiştir' demek işe yaramıyor; tek traktörü, tek alıcısı var."
2. **Tarla (15 sn).** Haritada Çumra noktası. Formda iki soru: son ektiğiniz ürün ve sulama imkânınız. Mevcut planı girin: buğday, nadas, buğday. **Tarlamı değerlendir.**
3. **Cevap (30 sn).** Tek kart: *"Planınızda tek bir şeyi değiştirin: 1. ekimde buğday yerine nohut."* Alt alta iki şerit: şimdiki plan ve öneri; değişen tek kutu yeşil. Gerekçe: 2 tekrar kırılıyor, tarla 8 ay daha az boş kalıyor (24 aydan 16 aya), plan 44 ay yerine 32 ay sürüyor.
4. **Neden bu (30 sn).** "Model 18 tek döngü değişikliğini sıraladı." Dört adımı sırayla söyleyin. Sulamasız ayçiçeği ve mısır eleniyor: yağış, su ihtiyaçlarının %33 ve %18'ini karşılıyor, eşik %40.
5. **Kurak yıl (15 sn).** "2025 gibi bir yılda bu plan yine uygun kalıyor." Kayıttaki en kurak tam yıl 347 mm, medyan 528 mm.
6. **Kanıt (30 sn).** **Hesabı ve kaynakları göster** → *Published field evidence*. 11 kontrolün 11'i tutuyor; 5'i modelin hiçbir parametresini belirlemeyen denemelerden. Ankara'da dört sezonluk buğday denemesi: sahada %60, modelde %56.
7. **Kapanış (15 sn).** "Verim ya da gelir sözü vermiyoruz. NASA verisi ızgara tahmini, tarlanın kendi ölçümü değil. Kararı çiftçi ve ziraat mühendisi verir."

Formülle ya da grafikle başlamayın. Teknik derinlik 6. adımda geliyor.

## Soru gelirse: kısıtlar nasıl çalışıyor

Sulu tarla senaryosu, önceki ürün nohut, ilk hasat en geç Temmuz 2027. 120 adayın 20'si bu tarihe yetişiyor.

| Sezonluk kota | Kotaya uyan | En yüksek puanlı kalan plan |
|---|---:|---|
| 340 m³/da | 6 | Mercimek → buğday → nohut |
| 310 m³/da | 2 | Mercimek → arpa → buğday |
| 300 m³/da | 0 | En düşük modellenen kota 308,89 m³/da |

Kota, her ürün sezonunda kök bölgesine ulaşan net suyu temsil eder; pompalanan su sistem randımanına göre daha fazladır. Aynı kural kurak yıl tekrarında da çalışıyor.

## Hazırlık

- Demodan önce Çumra noktası için bir analiz çalıştırın: sonuç 24 saat önbellekte kalır, NASA yavaşlarsa demo durmaz.
- Üretim derlemesiyle gösterin (`npm run build && npm run start`). Geliştirme modunda haritada konsol hataları çıkıyor.
- Dil düğmesi sağ üstte: jüri İngilizce isterse tek tıkla geçin.
- Mevcut planı girmeden de çalışır; o zaman kart "Gelecek sezon için güçlü seçenek: Nohut" der.

## Söylenmeyecekler

- Verim artışı, gelir artışı, su tasarrufu miktarı. Kazanım yalnızca dört ölçüyle ifade edilir: yetişmeyecek ürün, tekrar eden geçiş, en yüksek sezonluk sulama, ana ürünsüz ay.
- "Doğrulandı." Model yayımlanmış saha sonuçlarıyla tutuyor; üretici tarlasında denenmedi.
- "Benzersiz." Rotasyon planlama başka ürünlerde de var; ayırt edici olan tek değişiklik önerisi ve her istekte çalışan kanıt karşılaştırması.
