# Production Readiness Analysis — copilot-mobile

> **Tarih:** 2026-04-24  
> **Amaç:** Projenin (copilot-mobile) production'a çıkmadan önce eksiksiz olup olmadığının derinlemesine analizi.  
> **Kural:** Herhangi bir kod değişikliği yapılmamıştır. Rapor, Codex ve Claude ajanlarının aksiyon alabilmesi için hazırlanmıştır.

---

## 1. Genel Durum Özeti

Mevcut projenin temel yapıtaşları (tests & type-safety) mükemmel durumda, ancak production'da kritik hatalara, bellek sızıntılarına (memory leak) ve kimlik doğrulama sorunlarına yol açabilecek bazı yapısal kusurlar bulunuyor. 

| Kategori | Durum |
| :--- | :--- |
| **Typecheck (`pnpm typecheck`)** | ✅ Başarılı (Hata yok) |
| **Tests (`pnpm test`)** | ✅ Başarılı (Tüm E2E testleri geçiyor) |
| **Debug Logları** | ✅ Temiz (`console.log` kalıntısı yok, sadece gerekli yerlerde `console.warn` var) |
| **Kod İçi TODO/FIXME** | ✅ Temiz (Geliştirici kalıntısı yok) |
| **Production Yapılandırması** | ⚠️ İyileştirme gerekli (bkz. Bulgular) |

---

## 2. Codex / Claude İçin Aksiyon Planı (Kritik & Yüksek Öncelikli Bulgular)

Aşağıdaki bulgular, uygulamanın production ortamında stabil çalışabilmesi için **kesinlikle** çözülmelidir. Lütfen bu maddeleri birer task olarak ele alın.

### 🔴 CRITICAL (Bloker)
1. **STN5 — SecureStore Dual-Write Atomicity (Kimlik Tutarsızlığı):**
   - **Konum:** `apps/mobile/src/services/credentials.ts:131-152`
   - **Sorun:** `primary` ve `legacy` key'lerine yapılan yazma işlemleri atomik değil. Biri başarılı olup diğeri başarısız olursa, uygulamanın state'i asenkronize (tutarsız) hale gelir. `getItem` daima ilk key'e baktığı için kullanıcı kimliği doğrulanmış gibi görünüp aslında kimlik verisini kaybetmiş olabilir.
   - **Aksiyon:** Bu iki yazımı bir transaction veya güvenli fallback mekanizması ile güvence altına alın.

### 🟠 HIGH (Önemli Hatalar)
1. **BN4 — Push Bildirimlerinde Hata Yutulması:**
   - **Konum:** `apps/mobile/src/notifications/completion-notifier.ts`
   - **Sorun:** `notifyForBackgroundSync()` gibi asenkron fonksiyonlar `void` olarak çağrılıyor. İçeride bir `try-catch` olsa da, kurulum aşamasında (try öncesi) fırlayan bir null-reference veya konfigürasyon hatası tamamen gizlenir. Production'da bildirimlerin sessizce çökmesine yol açar.
   - **Aksiyon:** Bu fonksiyonların çağrıldığı noktalarda tam asenkron hata yakalama uygulayın.

2. **SN3 — Background Session UI Cleanup Eksikliği:**
   - **Konum:** `apps/mobile/src/services/message-handler.ts:514-520`
   - **Sorun:** Arka plan session'ı `idle` state'e geçtiğinde, sadece aktif olan session'ın state'i temizleniyor. Kullanıcı, arka planda biten bir session'a geri dönerse UI sürekli "Assistant çalışıyor..." state'inde kalır.
   - **Aksiyon:** `!isActiveSession(...)` kontrolünde `return` veya `break` yapmadan önce zustand store'daki ilgili session state'ini temizleyin.

3. **SN4 — WebSocket Reconnection Event Race Condition:**
   - **Konum:** `apps/mobile/src/services/ws-client.ts:372-377`
   - **Sorun:** `connectToURL`'de mevcut bağlantı `cleanup()` ile senkron kapatılırken eski `onclose` event'i tetikleniyor. Bu eski event handler, eski `reconnectOnClose` flag'ini okuduğu için istenmeyen reconnect döngülerine neden olabilir.
   - **Aksiyon:** `cleanup()` çağırmadan önce `reconnectOnClose` veya benzer bayrakların senkronize güncellendiğinden emin olun.

4. **BN1 — `sendMessage` İçi Race Condition (Meşgul State'i):**
   - **Konum:** `apps/bridge-server/src/copilot/session-manager.ts:879-888`
   - **Sorun:** Üst üste gelen mesajlarda `setSessionBusy(sessionId, true)` kontrolsüz ayarlanıyor. Başarı durumunda `false`'a çekilmiyor (sadece SDK eventine güveniliyor). SDK bug'a girerse session kilitlenir.
   - **Aksiyon:** Hata bloklarının ötesinde, tam bir meşgul (lock) koruması ve timeout eklenmeli.

---

## 3. UI, Lokalizasyon (i18n) ve Optimizasyon Önerileri

1. **Hardcoded Türkçe Metinler (Global Launch İçin Risk):**
   Production build'inde uygulamanın uluslararası kitlesi olacaksa, hardcoded olarak kalmış Türkçe metinler İngilizce'ye çevrilmeli veya bir `i18n` kütüphanesine (ör: `expo-localization`) taşınmalıdır.
   - Örnek: `apps/mobile/app/(drawer)/index.tsx:508`'deki *"Seçilen görseller bridge aktarım limitini aşıyor..."* hatası.
   - Örnek: `apps/mobile/src/components/TodoPanel.tsx`'deki *"Todo listesini gizle/göster"* gibi accessibility etiketleri.

2. **UI Performansı (C5 - computeDiff):**
   - **Konum:** `apps/mobile/src/components/ToolCard.tsx`
   - **Sorun:** Çok uzun diff hesaplamaları render esnasında senkron olarak yapılıyor (O(m*n)). Uzun dosyalarda ana thread bloklanacak ve uygulama (Mobile) donacaktır.
   - **Aksiyon:** Bu işlemi arka planda (Web Worker veya React `useTransition` / `InteractionManager`) hesaplayacak şekilde ayırın.

3. **Zustand Immutability İhlali (ST2):**
   - **Konum:** `apps/mobile/src/stores/session-store.ts:349`
   - **Sorun:** `items.pop()` doğrudan mutasyon yapıyor. Shallow copy referansını değiştirmek, bazı ekranlarda React re-render'larının tetiklenmemesine yol açar. 
   - **Aksiyon:** Mutasyon yerine `items.slice(0, -1)` kullanılmalı.

---

## 4. Sonuç & Doğrulama
Kod analizi ve statik analiz testleri gösteriyor ki, proje bağımlılık ve build (derleme) olarak production-ready. Ancak, Bridge ve Mobile Client arasındaki WebSocket iletişimi ile cihaz içi veri depolaması (SecureStore) alanlarındaki **race-condition** ve **error-swallowing (sessiz yutulan hatalar)** problemleri çözülmeden App Store veya Google Play Store'a canlı çıkış (production rollout) yapılması ciddi stabilite sorunlarına yol açacaktır.

**Lütfen yukarıdaki 2. ve 3. maddedeki aksiyonları sırasıyla uygulayın.**
