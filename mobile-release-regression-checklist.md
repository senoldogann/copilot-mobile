# Mobil Release Regresyon Checklist

## Kapsam

App Store veya TestFlight adayı onaylanmadan önce bu checklist gerçek iPhone ve Android cihazlarda çalıştırılmalı.

## Arka Plan Push

- Uygulama arka plandayken izin gerektiren session push üretir ve bildirime dokununca doğru session açılır
- Uygulama arka plandayken tamamlanan session push üretir ve bildirime dokununca doğru session açılır
- Uygulama ön plandayken tekrar eden veya gereksiz completion push gösterilmez
- Android tarafında bildirim ikonu, başlık, içerik ve accent color doğru görünür
- İzin reddedildiğinde uygulama bozulmaz; onboarding ve settings ekranları durumu açık şekilde anlatmaya devam eder

## Reconnect

- Aktif session sırasında ağı kes, sonra geri getir; session duplicate mesaj üretmeden devam etmeli
- Reconnect sırasında uygulamayı arka plana atıp yeniden aç; chat state tutarlı kalmalı
- Uygulama tamamen kapatılıp yeniden açıldıktan sonra reconnect aktif session ve bekleyen prompt’ları doğru geri getirmeli
- Kuyruklanan live event’ler `session.history` geldikten sonra sıra dışı görünmemeli

## Stop Session

- Aktif generation sırasında abort verilince UI, server acknowledgement gelene kadar busy kalmalı
- Başarısız abort; prompt’ları, tool state’lerini veya kullanıcıya görünen session state’i yanlış temizlememeli
- Abort acknowledgement sonrası geç gelen tool/message delta’ları bitmiş turn’ü yeniden açmamalı

## Git İşlemleri

- `Commit` yeni commit oluşturur ve recent commits ile diff state’i yeniler
- `Pull`; up-to-date, başarılı ve güvenli hata senaryolarını paneli dondurmadan yönetir
- `Push`; başarı ve reject durumlarını arkada takılı loading bırakmadan yönetir
- Recent commits listesi subject, relative time, author, hash ve değişen dosyaları doğru gösterir
- Diff paneli tekrar tekrar açılıp kapatıldığında stuck loading veya crash üretmez

## Onboarding

- Step geçişleri swipe ve butonlarla doğru çalışır
- `Enable alerts` butonu her tap için yalnızca bir kez izin ister ve sonra doğru şekilde idle state’e döner
- `Open app` ve `Scan QR code` onboarding’i tamamlayıp doğru ekrana yönlendirir
- Layout küçük telefonlarda ve büyük cihazlarda stabil kalır

## Büyük Chat Performansı

- Çok sayıda tool call içeren uzun chat, büyük boşluklar oluşturmadan scroll edilir
- Arka plandan geri dönüldüğünde scroll state görsel zıplama olmadan korunur
- Uzun streaming response CPU’yu gereksiz zıplatmaz ve telefonu anormal şekilde ısıtmaz
- Uygulama arka plandayken thinking/tool animasyonları durur
- Uzun chat sırasında workspace/diff panelini açıp kapatmak scroll performansını bozmaz

## Marka

- Launcher icon, splash, onboarding ve notification icon güncel marka asset’lerini tutarlı şekilde kullanır
- Kullanıcıya görünen metinlerde uygulama Copilot veya VS Code klonu gibi okunmaz
