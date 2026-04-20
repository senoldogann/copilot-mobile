# Copilot Mobile — Audit Bulguları ve Aksiyon Planı

Tarih: 2026-04-21

## 1. Audit Bulguları (önceki turun özeti)

### Kritik (C)
- **C1 — Transport TLS'siz.** `apps/bridge-server/src/ws/server.ts` `createHttpServer()` kullanıyor (düz HTTP+WS). `auth/certs.ts` içinde `getOrCreateTLSCredentials()` ve `setupTLSWithOpenSSL()` tam yazılmış fakat hiçbir yerde çağrılmıyor.
- **C2 — QR TLS fingerprint'i boş.** `auth/qr.ts` L14-18 `certFingerprint: null` döndürüyor. Mobil tarafta `ws-client.ts` fingerprint'i `pairing.success` geldikten sonra doğruluyor (pairing token zaten gönderilmiş oluyor).
- **C3 — JWT query string üzerinden gönderiliyor.** `ws/server.ts` L88-89 JWT'yi URL query'den okuyor. Reverse proxy / log sızıntısı riski.

### Yüksek (H)
- **H1 — authTimeout sızıntısı.** `ws/server.ts` L98-120, JWT ile auto-auth olduğunda 30 sn'lik authTimeout clear edilmiyor.
- **H2 — JWT secret persistency yok.** `auth/jwt.ts` L18-33 rotasyon sadece in-memory. Bridge restart = tüm telefonlar invalidate.
- **H3 — Kalıcı eşleşme yok.** Mobil tarafta `connection-store.ts` tamamen in-memory. Uygulama kapandığında JWT + serverUrl kayboluyor; her açılışta QR okutmak gerekiyor. `expo-secure-store` dep'te mevcut ama kullanılmıyor.
- **H4 — Remote erişim yok.** README "evde olmasan da" derken bridge yalnızca LAN. Dev tunnel entegrasyonu design doc'ta (L349) unchecked TODO.

### Orta (M)
- **M1 — Rate limiter sınırsız büyüyebilir.** `utils/rate-limit.ts` in-memory map, IP/key başına kayıt ekliyor, TTL cleanup yok.
- **M2 — Zod hata detayı sızıntısı.** `ws/handler.ts` L71-76 validation hatasını olduğu gibi dönüyor.
- **M3 — README vs design vs kod çelişkili.** Üç farklı yerde üç farklı vaad var.

### Uygulama / Kullanıcı Tarafı (yeni bulgular — bu tur raporlananlar)
- **U0 — `session.state` validation hatası.** Mobil, workspace'lerden bir sohbet seçilince `Server message validation failed: payload.runtimeMode — required` alıyor. Sebep: `copilot/client.ts::readSDKSessionState` `modeResult.mode`'u doğrudan kullanıyor; SDK bazen bu alanı tanımsız/boş döndürüyor (özellikle resume akışında). Zod şeması ise `runtimeMode`'u zorunlu enum olarak işaretliyor.
- **U1 — Boş sohbet logosu yanlış.** `EmptyChat.tsx` `SparklesIcon` (jenerik yıldız) kullanıyor. `ProviderIcon.tsx` içinde `CopilotIcon` SVG'si tanımlı ama export edilmemiş.
- **U2 — Header'daki 3-nokta menü ölü.** `app/(drawer)/index.tsx` `MoreVerticalIcon` butonunda `onPress` yok.
- **U3 — Workspace dosya içerik görüntüleyicisi workspace panelinden tetiklenmiyor.** `FileContentViewer` var ama sadece markdown file-link'lerinden açılıyor; Files sekmesi ve Changes sekmesi dosyaları clickable değil.
- **U4 — Changes panel kısmen fonksiyonsuz.** 3 görünüm ikonu (paragraph/diff/tree) yalnızca lokal `viewMode` state'ini değiştiriyor, dosya listesinin render'ını etkilemiyor. "Uncommitted" metni bir Pressable ama tıklanınca bir şey yapmıyor (committed seçeneği yok). Dosya satırları tıklanınca diff açmıyor.
- **U5 — Ayarlar ekranı fazla.** Models, Reasoning Effort ve Default Approvals hepsi input'taki ayar menüsünde zaten mevcut → settings ekranında tekrarlanmamalı.
- **U6 — Model chip arka planı opak + mikrofon butonu ölü.** `ChatInput.tsx` `modelPill` `backgroundColor: colors.bgElevated`; mikrofon butonu `toolBtnDimmed` ile devre dışı görüntülü ve `Pressable` değil.
- **U7 — @ ve / autocomplete yok.** TextInput'un placeholder'ı "@files, /commands" diyor ama ne mention ne slash command picker var.

---

## 2. Aksiyon Planı (bu turda yapılacaklar)

Kullanıcı explicit öncelik: **UI/UX sorunları + runtimeMode düzeltmesi**. (Remote-access + persistence büyük iş; ayrı bir turda ele alınacak.)

### P0 — U0: `runtimeMode` validation hatası
`bridge-server/src/copilot/client.ts::readSDKSessionState` ve `applySDKSessionState` içinde `modeResult.mode` tanımsız / beklenmeyen ise `deriveRuntimeMode(stateRef)` fallback'ine düş.
`session-manager.ts::emitSessionState` içinde runtimeMode her zaman geçerli bir enum olacak şekilde guard ekle.

### P0 — U1: Copilot SVG'sini boş chat'e getir
`ProviderIcon.tsx`'ten `CopilotIcon`'u export et; `EmptyChat.tsx`'te `SparklesIcon` yerine bunu kullan.

### P0 — U2: Header 3-nokta menüsü
`(drawer)/index.tsx` `MoreVerticalIcon` butonuna bir dropdown menü: **New chat**, **Settings**, **Disconnect**. Küçük bir popover / action sheet.

### P0 — U3 + U4: Workspace dosya görüntüleyici + diff
1. `ChatMessageItem.tsx` içindeki `FileContentViewer` bileşenini kendi dosyasına çıkar (`components/FileContentViewer.tsx`). Export et.
2. `WorkspacePanel.tsx` Files tab ağaç node'larında dosya satırına basılınca viewer aç.
3. Changes tab uncommitted dosya satırlarına basılınca **diff viewer** aç.
4. Diff için yeni protokol mesajı: `workspace.diff.request` / `workspace.diff.response` — sunucu `git diff -- <path>` çalıştırıp unified diff döndürsün. Untracked dosya için `diff --no-index /dev/null <path>`.
5. "Uncommitted" başlığına dropdown ekle (Uncommitted / History / Stash gibi VS Code tarzı, ama şimdilik sadece **Uncommitted** ve **Recent commits** iki seçenek yeterli).
6. Sağdaki 3 görünüm ikonunu (paragraph/diff/tree) **değişikliklerin render moduna** bağla:
   - `paragraph`: dosya adları liste (mevcut davranış).
   - `diff`: her satırın altında +additions / -deletions stats.
   - `tree`: dosyaları klasör ağacına gruplayarak göster.
7. Commit popover (Pull / Push) zaten bağlı ve çalışıyor — teyit et.

### P1 — U5: Ayarlar ekranını sadeleştir
`settings.tsx`'ten `ModelPicker`, `ReasoningEffortPicker`, `ApprovalSettings`'i çıkar. Yalnızca `ConnectionInfo` + footer kalsın. Versiyon + bridge teşhis bilgileri görünür kalsın.

### P1 — U6: Model chip + mikrofon
- `ChatInput.tsx` `toolbarStyles.modelPill.backgroundColor` → `"transparent"`. Border'ı `borderMuted`'e indir.
- Mikrofon butonu: `expo-speech-recognition` ekle (Expo SDK 54 ile uyumlu). Basılınca dinlemeye başla, transkripti `setInput` ile TextInput'a yaz. Dev-build gerekliliği nedeniyle runtime guard: import fail olursa Alert göster ("Voice requires dev build").
- Model listesi zaten `listModels()` ile bridge'den geliyor (SDK `rpc.models.list()` — VS Code Copilot ile aynı kaynak). Ek iş yok; validate ettik.

### P1 — U7: @ ve / autocomplete
`ChatInput.tsx` içinde cursor pozisyonu tabanlı basit parser:
- Kullanıcı `@` yazarsa popover aç; aktif workspace tree dosyalarını filtreli göster. Seçim = metne `@path/to/file.ext ` ekle ve bridge'e attachment olarak ekle (attachmentNew = ilerde; şimdilik sadece metin referansı).
- Kullanıcı `/` yazarsa popover aç; `/clear`, `/help`, `/explain`, `/fix`, `/tests`, `/new`, `/doc` statik listesini göster. Seçim = metne komut ekle.
- VS Code Copilot'taki chat participants (`@workspace`, `@vscode`, `@terminal`) bu bridge mimarisinde ayrı ayrı yok — tüm mesaj zaten aktif session context'ine gidiyor. O yüzden `@` sadece workspace dosyalarını referanslıyor.

### P2 — Doğrulama
`pnpm typecheck`, `pnpm test:bridge`, `pnpm build:shared`, `pnpm build:bridge`.

---

## 3. Dışarıda Bırakılanlar (gelecek turlar)

- **Persistence** (H3): `expo-secure-store` ile JWT + serverUrl + fingerprint sakla. Uygulama açılışında auto-reconnect.
- **Remote access** (H4): Cloudflare Tunnel / VS Code `code tunnel` entegrasyonu.
- **TLS hardening** (C1-C3): WSS enforcement + pre-pairing fingerprint check.
- **JWT secret persistency** (H2): Rotated secret'ları `~/.copilot-mobile/jwt-secrets.json`'a yaz.
- **authTimeout leak** (H1) + **rate-limiter bounds** (M1) + **Zod sanitize** (M2).

Kullanıcı onayından sonra bu turu ayrıca açacağız.
