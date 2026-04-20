# Copilot Mobile Bridge — Tasarım Dokümanı

> **Tarih:** 20 Nisan 2026  
> **Yazar:** Senol Dogan  
> **Durum:** Tasarım Aşaması

## 1. Vizyon

Telefondan QR kod okutarak bilgisayardaki VS Code/Copilot ortamına bağlanıp, aynı masaüstündeki gibi ajanla sohbet ederek kod yazdırabilme. Tüm işlemler (dosya okuma/yazma, terminal komutları, araç çağrıları) bilgisayarda gerçekleşir; telefon yalnızca sohbet arayüzü ve kontrol paneli olarak çalışır.

---

## 2. Fizibilite Analizi

### 2.1 Kritik Keşif: `@github/copilot-sdk`

GitHub, Copilot CLI'ın arkasındaki motoru programatik olarak kullanabilmek için **public preview** bir SDK yayınladı (MIT lisanslı, v0.2.2):

| Özellik | Destek |
|---------|--------|
| Session oluşturma/devam ettirme | ✅ `createSession()` / `resumeSession()` |
| Model seçimi | ✅ `gpt-5`, `claude-sonnet-4.5`, vb. |
| Reasoning effort | ✅ `low`, `medium`, `high`, `xhigh` |
| Streaming yanıtlar | ✅ `assistant.message_delta` event'leri |
| Tool execution izinleri | ✅ `onPermissionRequest` handler |
| Kullanıcı girişi istekleri | ✅ `onUserInputRequest` handler |
| Dosya ekleme (image dahil) | ✅ `attachments` + base64 blob |
| Uzak CLI sunucusuna bağlanma | ✅ `cliUrl` parametresi |
| Birden fazla eşzamanlı session | ✅ Bağımsız session'lar |
| Custom tool tanımlama | ✅ `defineTool()` + Zod schema |
| Session hook'ları | ✅ `onPreToolUse`, `onPostToolUse`, vb. |
| GitHub OAuth + Token auth | ✅ `githubToken` parametresi |
| BYOK (kendi API anahtarın) | ✅ OpenAI, Azure, Anthropic, Ollama |

**Sonuç:** SDK, bir mobile bridge için gereken TÜM API'ları sağlıyor. Bu proje kesinlikle yapılabilir.

### 2.2 VS Code Dev Tunnels

- `code tunnel` komutu güvenli relay sağlar
- GitHub OAuth ile kimlik doğrulama
- AES-256 CTR şifreleme + SSH üzerinden
- Servis olarak çalışabilir (`code tunnel service install`)
- Açık kaynak: github.com/microsoft/dev-tunnels

### 2.3 Risk Analizi

| Risk | Seviye | Azaltma Stratejisi |
|------|--------|---------------------|
| SDK public preview (API değişebilir) | Orta | SDK sürüm kilitlenmesi, adapter pattern |
| Mobil ağ latansı | Düşük | Streaming UI, optimistic updates |
| Bilgisayar uyku modu | Düşük | Wake-on-LAN + `--no-sleep` flag |
| Rate limiting | Düşük | SDK kendi throttling'ini yönetiyor |
| Güvenlik (uzaktan erişim) | Orta | mTLS, token rotasyonu, izin whitelist'i |

---

## 3. Mimari Tasarım

### 3.1 Genel Bakış

```
┌─────────────────────┐         ┌──────────────────────────────┐         ┌──────────────────┐
│   📱 Mobile App     │◄──WSS──►│   🖥️ Bridge Server (Node.js) │◄──RPC──►│ Copilot CLI      │
│   (React Native)    │         │   (@github/copilot-sdk)      │         │ (JSON-RPC Server)│
│                     │         │                              │         │                  │
│ • Chat UI           │         │ • WebSocket Server           │         │ • Model Runtime  │
│ • QR Scanner        │         │ • Session Manager            │         │ • Tool Executor  │
│ • Permission UI     │         │ • Auth Gateway               │         │ • File System    │
│ • Settings Panel    │         │ • QR Code Generator          │         │ • Git Operations │
│ • File Viewer       │         │ • Permission Proxy           │         │ • Terminal       │
└─────────────────────┘         └──────────────────────────────┘         └──────────────────┘
                                           │
                                    (Opsiyonel)
                                           │
                                ┌──────────▼──────────┐
                                │ Dev Tunnel (Azure)   │
                                │ Dış ağdan erişim     │
                                └──────────────────────┘
```

### 3.2 Bileşenler

#### A) Bridge Server (Node.js — Ana Bileşen)

Desktop bilgisayarda çalışır. Copilot SDK ile Copilot CLI arasında köprü kurar ve WebSocket üzerinden mobil uygulamayla iletişim sağlar.

**Sorumluluklar:**
1. Copilot CLI'ı server modunda başlatma ve yönetme
2. WebSocket sunucusu (mobil istemci bağlantısı)
3. QR kod üretimi (bağlantı bilgileri + tek kullanımlık token)
4. Session yaşam döngüsü yönetimi
5. İzin isteklerini mobil uygulamaya proxy'leme
6. Kullanıcı girişi isteklerini iletme
7. Streaming yanıtları real-time iletme
8. Güvenlik: token doğrulama, rate limiting, IP whitelist

**Teknoloji:**
- Runtime: Node.js 20+
- SDK: `@github/copilot-sdk`
- WebSocket: `ws` kütüphanesi
- QR: `qrcode` kütüphanesi
- Auth: JWT + TOTP pairing

#### B) Mobile App (React Native + Expo)

**Ekranlar:**
1. **Pairing Screen** — QR kod tarayıcı, bağlantı durumu
2. **Chat Screen** — Mesaj listesi, streaming yanıtlar, markdown render
3. **Permission Dialog** — Tool execution izin istekleri (approve/deny)
4. **Settings Screen** — Model seçimi, reasoning effort, session yönetimi
5. **File Viewer** — Değiştirilen dosyaları görüntüleme (read-only)
6. **Session List** — Aktif ve geçmiş session'lar

**Teknoloji:**
- Framework: React Native + Expo (iOS + Android)
- State: Zustand
- WebSocket: Native WebSocket API
- UI: React Native Paper veya NativeWind (Tailwind CSS)
- Markdown: `react-native-markdown-display`
- QR: `expo-camera` (QR scanner)
- Haptics: `expo-haptics` (permission feedback)

### 3.3 İletişim Protokolü

Bridge Server ile Mobile App arasındaki WebSocket mesaj formatı:

```typescript
// Temel mesaj yapısı
type BridgeMessage = {
  id: string;            // Mesaj ID (UUID)
  type: MessageType;     // Mesaj tipi
  timestamp: number;     // Unix timestamp
  payload: unknown;      // Mesaj verisi
};

// Server → Client mesaj tipleri
type ServerMessageType =
  | "session.created"          // Session başarıyla oluşturuldu
  | "session.resumed"         // Session devam ettirildi
  | "session.idle"            // Session boşta
  | "assistant.message"       // Tam yanıt
  | "assistant.message_delta" // Streaming parça
  | "assistant.reasoning"     // Reasoning içeriği
  | "tool.execution_start"   // Tool çalışmaya başladı
  | "tool.execution_complete" // Tool tamamlandı
  | "permission.request"     // İzin isteniyor
  | "user_input.request"     // Kullanıcı girişi isteniyor
  | "models.list"            // Mevcut model listesi
  | "error"                  // Hata
  | "pairing.success"        // QR eşleşme başarılı
  | "connection.status";     // Bağlantı durumu

// Client → Server mesaj tipleri
type ClientMessageType =
  | "session.create"          // Yeni session oluştur
  | "session.resume"         // Mevcut session'ı devam ettir
  | "session.list"           // Session listesini iste
  | "message.send"           // Mesaj gönder
  | "message.abort"          // Aktif mesajı iptal et
  | "permission.respond"     // İzin yanıtı
  | "user_input.respond"     // Kullanıcı girişi yanıtı
  | "settings.update"        // Ayar güncelleme
  | "models.request"         // Model listesini iste
  | "auth.pair";             // QR pairing token'ı
```

### 3.4 Güvenlik Mimarisi

```
Pairing Akışı:
1. Bridge Server başlar → Rastgele pairing token üretir (32 byte)
2. Token + WS URL + port → QR kod olarak ekranda gösterilir
3. Mobil uygulama QR'ı okur → WebSocket bağlantısı açar
4. Mobil, pairing token'ı gönderir → Server doğrular
5. Server, session JWT üretir → Mobil'e gönderir
6. Sonraki tüm mesajlar JWT ile doğrulanır

Güvenlik Katmanları:
- QR token: Tek kullanımlık, 5 dakika TTL
- JWT: 24 saat TTL, refresh mekanizması
- WebSocket: WSS (TLS) — local ağda self-signed cert
- Dev Tunnel kullanımında: Azure tarafından sağlanan E2E şifreleme
- Permission proxy: Tüm tool çağrıları mobil kullanıcı onayı gerektirir
- IP whitelist: Opsiyonel, sadece belirli IP'lerden bağlantı
```

### 3.5 Çalışma Senaryoları

**Senaryo 1: Aynı Ağ (Ev/Ofis)**
```
Telefon ←─ WiFi ─→ Bridge Server (bilgisayar)
- Doğrudan WebSocket bağlantısı
- Düşük latans (~1-5ms)
- QR kodda local IP + port
```

**Senaryo 2: Dış Ağ (Dışarıda)**
```
Telefon ←─ 4G/5G ─→ Dev Tunnel (Azure) ←─→ Bridge Server (bilgisayar)
- Dev Tunnel üzerinden şifreli tünel
- Orta latans (~50-200ms)
- QR kodda tunnel URL
```

**Senaryo 3: Hibrit (Otomatik)**
```
- Bridge Server her iki modu da dinler
- Mobil uygulama önce local IP'yi dener
- Başarısız olursa tunnel URL'e fallback yapar
```

---

## 4. Veri Akışı

### 4.1 Chat Mesajı Akışı

```
Mobile App                Bridge Server              Copilot CLI
    │                          │                          │
    │─── message.send ────────►│                          │
    │    {prompt: "..."}       │                          │
    │                          │─── session.send() ──────►│
    │                          │    {prompt: "..."}       │
    │                          │                          │
    │◄── tool.execution_start─│◄── tool.start event ────│
    │    {tool: "read_file"}  │                          │
    │                          │                          │
    │◄── permission.request ──│    (onPermissionRequest) │
    │    {kind: "read",       │                          │
    │     fileName: "..."}    │                          │
    │                          │                          │
    │─── permission.respond ──►│                          │
    │    {decision: "approved"}│── return {approved} ────►│
    │                          │                          │
    │◄── assistant.msg_delta ─│◄── delta event ─────────│
    │    {deltaContent: "He"} │                          │
    │◄── assistant.msg_delta ─│◄── delta event ─────────│
    │    {deltaContent: "llo"}│                          │
    │                          │                          │
    │◄── assistant.message ───│◄── final message ───────│
    │    {content: "Hello"}   │                          │
    │                          │                          │
    │◄── session.idle ────────│◄── idle event ──────────│
    │                          │                          │
```

---

## 5. Tech Stack Özeti

| Katman | Teknoloji | Gerekçe |
|--------|-----------|---------|
| Bridge Server Runtime | Node.js 20+ | Copilot SDK'nın birincil desteği |
| Copilot Entegrasyonu | `@github/copilot-sdk` v0.2.x | Resmi GitHub SDK |
| WebSocket Server | `ws` | Hafif, performanslı, Node.js native |
| QR Kod | `qrcode` | Server-side QR üretimi |
| Auth | `jsonwebtoken` + `crypto` | JWT + TOTP pairing |
| Tunnel | VS Code Dev Tunnels | Resmi, güvenli, ücretsiz |
| Mobile Framework | React Native + Expo | Cross-platform, hızlı iterasyon |
| Mobile State | Zustand | Minimal, TypeScript-first |
| Mobile UI | NativeWind (Tailwind) | Hızlı styling, consistent |
| Markdown Render | `react-native-markdown-display` | Chat yanıtları için |
| QR Scanner | `expo-camera` | Expo ekosistemi, kolay entegrasyon |
| Syntax Highlighting | `react-native-syntax-highlighter` | Kod blokları için |

---

## 6. Proje Yapısı

```
copilot-mobile/
├── apps/
│   ├── bridge-server/           # Node.js Bridge Server
│   │   ├── src/
│   │   │   ├── server.ts        # Ana giriş noktası
│   │   │   ├── copilot/
│   │   │   │   ├── client.ts    # CopilotClient sarmalayıcı
│   │   │   │   ├── session.ts   # Session yönetimi
│   │   │   │   └── events.ts    # Event mapping
│   │   │   ├── ws/
│   │   │   │   ├── handler.ts   # WebSocket mesaj yönlendirici
│   │   │   │   └── protocol.ts  # Mesaj tipleri ve şemaları
│   │   │   ├── auth/
│   │   │   │   ├── pairing.ts   # QR pairing mantığı
│   │   │   │   └── jwt.ts       # JWT üretimi/doğrulama
│   │   │   └── tunnel/
│   │   │       └── manager.ts   # Dev Tunnel yönetimi
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── mobile/                  # React Native (Expo) App
│       ├── app/                 # Expo Router sayfaları
│       │   ├── (tabs)/
│       │   │   ├── chat.tsx     # Ana sohbet ekranı
│       │   │   ├── sessions.tsx # Session listesi
│       │   │   └── settings.tsx # Ayarlar
│       │   ├── pair.tsx         # QR pairing ekranı
│       │   └── _layout.tsx
│       ├── components/
│       │   ├── ChatMessage.tsx  # Tekil mesaj bileşeni
│       │   ├── ChatInput.tsx    # Mesaj giriş alanı
│       │   ├── PermissionDialog.tsx
│       │   ├── ModelSelector.tsx
│       │   └── StreamingText.tsx
│       ├── stores/
│       │   ├── connection.ts    # WebSocket bağlantı durumu
│       │   ├── chat.ts          # Mesajlar ve session
│       │   └── settings.ts      # Kullanıcı tercihleri
│       ├── services/
│       │   ├── websocket.ts     # WebSocket istemcisi
│       │   └── qr.ts            # QR kod okuma
│       ├── types/
│       │   └── protocol.ts      # Paylaşılan tip tanımları
│       ├── app.json
│       └── package.json
│
├── packages/
│   └── shared/                  # Paylaşılan tipler ve sabitler
│       ├── src/
│       │   ├── protocol.ts      # Mesaj tipleri (her iki tarafça kullanılır)
│       │   └── constants.ts     # Sabitler
│       └── package.json
│
├── package.json                 # Monorepo kökü (pnpm workspaces)
├── pnpm-workspace.yaml
├── tsconfig.base.json
└── docs/
    └── superpowers/
        └── specs/
            └── 2026-04-20-copilot-mobile-bridge-design.md
```

---

## 7. MVP Kapsamı (v0.1)

### Dahil:
- [x] Bridge Server: Copilot SDK entegrasyonu
- [x] QR kod ile pairing (aynı ağ)
- [x] Chat UI: mesaj gönderme + streaming yanıt
- [x] Permission dialog: approve/deny
- [x] Model seçimi (runtime)
- [x] Reasoning effort ayarı
- [x] Session oluşturma ve devam ettirme
- [x] Temel markdown render (kod blokları dahil)

### Sonraki sürümler (v0.2+):
- [ ] Dev Tunnel entegrasyonu (dış ağ erişimi)
- [ ] Dosya görüntüleyici (değişiklik diff'leri)
- [ ] Image attachment (fotoğraf çekip gönderme)
- [ ] Bildirimler (push notification — tool onayı beklerken)
- [ ] Wake-on-LAN (bilgisayarı uzaktan uyandırma)
- [ ] Çoklu bilgisayar desteği
- [ ] Session paylaşımı / multi-client
- [ ] Sesli komut desteği (speech-to-text)

---

## 8. Açık Sorular

1. **iOS vs Android öncelik?** Expo ile ikisi de aynı anda yapılabilir, ama test önceliği?
2. **Tunnel varsayılan mı?** Her zaman tunnel mı açılsın, yoksa sadece dış ağda mı?
3. **Permission granularity:** Tüm read'ler auto-approve, sadece write/shell manuel mi?
4. **Offline deneyim:** Bağlantı koptuğunda mesaj geçmişi yerel cache'te tutulsun mu?
