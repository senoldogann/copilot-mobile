# Code Companion Bridge — Uygulama Planı

> **Agentic workers için:** Bu planı uygulamak için superpowers:subagent-driven-development veya superpowers:executing-plans skill'ini kullanın. Adımlar checkbox (`- [ ]`) syntax'ı ile takip edilir.

**Goal:** Telefondan QR kod okutarak bilgisayardaki Copilot ile sohbet edip kod yazdırabilen bir mobile bridge sistemi kurmak.

**Architecture:** Monorepo yapısında iki uygulama: (1) Bridge Server — Node.js üzerinde `@github/copilot-sdk` ile Copilot CLI'a JSON-RPC bağlantısı kuran ve WebSocket sunucu açan servis, (2) Mobile App — React Native (Expo) ile QR pairing, chat UI, permission yönetimi sağlayan mobil istemci.

**Tech Stack:** Node.js 20+, TypeScript, `@github/copilot-sdk`, `ws`, React Native, Expo, Zustand, NativeWind, pnpm workspaces

---

## Task 1: Monorepo Altyapısı

**Files:**
- Create: `package.json` (root)
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `packages/shared/package.json`
- Create: `packages/shared/tsconfig.json`
- Create: `packages/shared/src/protocol.ts`
- Create: `packages/shared/src/constants.ts`
- Create: `packages/shared/src/index.ts`

- [ ] **Step 1: Root monorepo kurulumu**

```bash
cd /Users/dogan/Desktop/copilot-mobile
pnpm init
```

Root `package.json`'a workspaces ve scripts ekle:
```json
{
  "name": "copilot-mobile",
  "private": true,
  "scripts": {
    "dev:bridge": "pnpm --filter bridge-server dev",
    "dev:mobile": "pnpm --filter mobile start",
    "build:bridge": "pnpm --filter bridge-server build",
    "typecheck": "pnpm -r typecheck"
  }
}
```

- [ ] **Step 2: pnpm-workspace.yaml oluştur**

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

- [ ] **Step 3: Shared types paketi oluştur**

`packages/shared/src/protocol.ts` — Bridge Server ve Mobile App arasındaki tüm mesaj tiplerini tanımla:

```typescript
// Temel mesaj zarfı
export type BridgeMessage<T = unknown> = {
  id: string;
  type: string;
  timestamp: number;
  payload: T;
};

// Server → Client
export type ServerMessageType =
  | "pairing.success"
  | "session.created"
  | "session.resumed"
  | "session.idle"
  | "session.list"
  | "assistant.message"
  | "assistant.message_delta"
  | "assistant.reasoning"
  | "assistant.reasoning_delta"
  | "tool.execution_start"
  | "tool.execution_complete"
  | "permission.request"
  | "user_input.request"
  | "models.list"
  | "error"
  | "connection.status";

// Client → Server
export type ClientMessageType =
  | "auth.pair"
  | "session.create"
  | "session.resume"
  | "session.list"
  | "session.delete"
  | "message.send"
  | "message.abort"
  | "permission.respond"
  | "user_input.respond"
  | "settings.update"
  | "models.request";

// Session ayarları
export type SessionConfig = {
  model: string;
  reasoningEffort: "low" | "medium" | "high" | "xhigh";
  streaming: boolean;
};

// İzin isteği
export type PermissionRequestPayload = {
  requestId: string;
  kind: "shell" | "write" | "read" | "mcp" | "custom-tool" | "url" | "memory" | "hook";
  toolName?: string;
  fileName?: string;
  fullCommandText?: string;
};

// İzin yanıtı
export type PermissionResponsePayload = {
  requestId: string;
  decision: "approved" | "denied";
};
```

- [ ] **Step 4: tsconfig.base.json oluştur**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  }
}
```

- [ ] **Step 5: Commit**

```bash
git init && git add -A && git commit -m "feat: monorepo altyapısı ve paylaşılan tipler"
```

---

## Task 2: Bridge Server — Copilot SDK Entegrasyonu

**Files:**
- Create: `apps/bridge-server/package.json`
- Create: `apps/bridge-server/tsconfig.json`
- Create: `apps/bridge-server/src/server.ts`
- Create: `apps/bridge-server/src/copilot/client.ts`
- Create: `apps/bridge-server/src/copilot/session-manager.ts`
- Create: `apps/bridge-server/src/copilot/events.ts`

- [ ] **Step 1: Bridge server paket kurulumu**

```bash
cd apps/bridge-server
pnpm init
pnpm add @github/copilot-sdk ws qrcode jsonwebtoken uuid zod
pnpm add -D typescript @types/ws @types/jsonwebtoken @types/uuid tsx
```

- [ ] **Step 2: Copilot Client sarmalayıcı yaz**

`src/copilot/client.ts` — CopilotClient'ı başlatan ve yöneten modül:

```typescript
import { CopilotClient } from "@github/copilot-sdk";

// CopilotClient instance'ı oluştur ve başlat
// githubToken parametresi ile auth sağla
// listModels() ile mevcut modelleri getir
// Hata durumunda spesifik hata fırlat
```

- [ ] **Step 3: Session Manager yaz**

`src/copilot/session-manager.ts` — Session CRUD operasyonları:

```typescript
// createSession: model, reasoningEffort, streaming ayarlarıyla session oluştur
// resumeSession: mevcut session'ı devam ettir
// listSessions: tüm session'ları listele  
// deleteSession: session sil
// onPermissionRequest callback'ini WebSocket'e proxy'le
// onUserInputRequest callback'ini WebSocket'e proxy'le
// Event listener'ları kaydet (delta, message, tool events)
```

- [ ] **Step 4: Event mapping modülü yaz**

`src/copilot/events.ts` — SDK event'lerini WebSocket mesajlarına dönüştür:

```typescript
// SDK SessionEvent → BridgeMessage dönüşümü
// assistant.message_delta → streaming parça
// tool.execution_start → tool bilgisi
// permission.request → mobil'e ilet
```

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: bridge server copilot SDK entegrasyonu"
```

---

## Task 3: Bridge Server — WebSocket Sunucusu

**Files:**
- Create: `apps/bridge-server/src/ws/server.ts`
- Create: `apps/bridge-server/src/ws/handler.ts`
- Create: `apps/bridge-server/src/ws/middleware.ts`

- [ ] **Step 1: WebSocket sunucu oluştur**

`src/ws/server.ts`:
```typescript
// ws kütüphanesi ile WebSocket sunucu başlat
// Port: env'den veya 9876 default
// Bağlantı kabul et, auth doğrula
// Heartbeat mekanizması (30 saniye ping/pong)
// Bağlantı kopma ve yeniden bağlanma yönetimi
```

- [ ] **Step 2: Mesaj yönlendirici (handler) yaz**

`src/ws/handler.ts`:
```typescript
// Gelen ClientMessageType'a göre uygun handler'a yönlendir
// session.create → SessionManager.create()
// message.send → session.send()
// permission.respond → pending permission callback'ini çöz
// message.abort → session.abort()
// Bilinmeyen mesaj tipleri için hata döndür
```

- [ ] **Step 3: Auth middleware yaz**

`src/ws/middleware.ts`:
```typescript
// İlk bağlantıda pairing token doğrula
// JWT üret ve client'a gönder
// Sonraki mesajlarda JWT doğrula
// Token süresi dolmuşsa yeni token üret
```

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: bridge server WebSocket sunucusu ve mesaj yönlendirici"
```

---

## Task 4: Bridge Server — QR Pairing ve Auth

**Files:**
- Create: `apps/bridge-server/src/auth/pairing.ts`
- Create: `apps/bridge-server/src/auth/jwt.ts`
- Create: `apps/bridge-server/src/auth/qr.ts`

- [ ] **Step 1: Pairing token üretici yaz**

`src/auth/pairing.ts`:
```typescript
// crypto.randomBytes(32) ile tek kullanımlık token üret
// 5 dakika TTL
// Kullanıldıktan sonra invalidate et
// Eşzamanlı yalnızca bir aktif pairing token
```

- [ ] **Step 2: JWT modülü yaz**

`src/auth/jwt.ts`:
```typescript
// Pairing başarılı → JWT üret (24 saat TTL)
// JWT payload: { deviceId, pairedAt, ip }
// JWT doğrulama fonksiyonu
// Token yenileme mekanizması
```

- [ ] **Step 3: QR kod üretici yaz**

`src/auth/qr.ts`:
```typescript
// qrcode kütüphanesi ile terminal'de QR göster
// QR içeriği: JSON { url, token, version }
// url: ws://LOCAL_IP:PORT veya tunnel URL
// token: pairing token
// Opsiyonel: PNG olarak dosyaya kaydet
```

- [ ] **Step 4: Ana giriş noktasını birleştir**

`src/server.ts`:
```typescript
// 1. CopilotClient başlat
// 2. WebSocket sunucu başlat
// 3. QR kod üret ve terminalde göster
// 4. Pairing bekle
// 5. Bağlantı kurulunca "hazır" logla
```

- [ ] **Step 5: Uçtan uca test — Bridge server başlatma**

```bash
cd apps/bridge-server
pnpm dev
# QR kodun terminalde görünmesi bekleniyor
# WebSocket sunucunun port'ta dinlemesi bekleniyor
```

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: QR pairing ve JWT auth sistemi"
```

---

## Task 5: Mobile App — Proje Kurulumu

**Files:**
- Create: `apps/mobile/` (Expo projesi)
- Modify: Root `package.json`

- [ ] **Step 1: Expo projesi oluştur**

```bash
cd apps
npx create-expo-app@latest mobile --template blank-typescript
cd mobile
npx expo install expo-camera expo-haptics expo-secure-store
pnpm add zustand react-native-markdown-display
pnpm add @copilot-mobile/shared@workspace:*
```

- [ ] **Step 2: Expo Router kur**

```bash
npx expo install expo-router expo-linking expo-constants
```

App dizin yapısını oluştur: `app/(tabs)/`, `app/pair.tsx`, `app/_layout.tsx`

- [ ] **Step 3: NativeWind (Tailwind) kur**

```bash
pnpm add nativewind tailwindcss
npx tailwindcss init
```

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: expo mobile app projesi kurulumu"
```

---

## Task 6: Mobile App — WebSocket İstemcisi ve Store'lar

**Files:**
- Create: `apps/mobile/services/websocket.ts`
- Create: `apps/mobile/stores/connection.ts`
- Create: `apps/mobile/stores/chat.ts`
- Create: `apps/mobile/stores/settings.ts`

- [ ] **Step 1: WebSocket istemci servisi yaz**

`services/websocket.ts`:
```typescript
// WebSocket bağlantısı yönet
// connect(url, token) → bağlan ve auth yap
// send(message) → mesaj gönder
// onMessage callback → store'ları güncelle
// Auto-reconnect (exponential backoff)
// Heartbeat yönetimi (pong yanıtla)
```

- [ ] **Step 2: Connection store yaz**

`stores/connection.ts`:
```typescript
// Zustand store
// state: { status, url, jwt, deviceId, error }
// actions: { connect, disconnect, setPaired }
// status: "disconnected" | "pairing" | "connected" | "reconnecting"
```

- [ ] **Step 3: Chat store yaz**

`stores/chat.ts`:
```typescript
// Zustand store
// state: { sessions, activeSessionId, messages, isStreaming, pendingPermission }
// actions: { 
//   addMessage, updateStreamingMessage, setIdle,
//   setPendingPermission, respondToPermission,
//   createSession, switchSession
// }
```

- [ ] **Step 4: Settings store yaz**

`stores/settings.ts`:
```typescript
// Zustand store + AsyncStorage persist
// state: { model, reasoningEffort, autoApproveReads, theme }
// actions: { setModel, setReasoningEffort, toggleAutoApproveReads }
```

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: WebSocket istemci ve Zustand store'ları"
```

---

## Task 7: Mobile App — QR Pairing Ekranı

**Files:**
- Create: `apps/mobile/app/pair.tsx`
- Create: `apps/mobile/components/QRScanner.tsx`
- Create: `apps/mobile/components/ConnectionStatus.tsx`

- [ ] **Step 1: QR Scanner bileşeni yaz**

`components/QRScanner.tsx`:
```typescript
// expo-camera ile QR tarayıcı
// Tarama sonucu: JSON parse → url + token çıkar
// Başarılı taramada haptic feedback
// Kamera izni yönetimi
```

- [ ] **Step 2: Pairing ekranı yaz**

`app/pair.tsx`:
```typescript
// Tam ekran QR tarayıcı
// Üstte: "QR Kodu Okutun" başlığı
// Ortada: Kamera viewport'u
// Altta: Bağlantı durumu göstergesi
// Tarama → WebSocket bağlantısı → auth.pair gönder
// Başarılı → chat ekranına yönlendir
```

- [ ] **Step 3: Bağlantı durumu bileşeni yaz**

`components/ConnectionStatus.tsx`:
```typescript
// Animasyonlu durum göstergesi
// "Taranıyor..." / "Bağlanıyor..." / "Eşleştirildi ✓" / "Hata ✗"
```

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: QR pairing ekranı ve kamera entegrasyonu"
```

---

## Task 8: Mobile App — Chat Ekranı

**Files:**
- Create: `apps/mobile/app/(tabs)/chat.tsx`
- Create: `apps/mobile/components/ChatMessage.tsx`
- Create: `apps/mobile/components/ChatInput.tsx`
- Create: `apps/mobile/components/StreamingText.tsx`
- Create: `apps/mobile/components/ToolExecutionCard.tsx`
- Create: `apps/mobile/components/PermissionDialog.tsx`

- [ ] **Step 1: ChatMessage bileşeni yaz**

```typescript
// Rol bazlı stil (user / assistant)
// Markdown render (react-native-markdown-display)
// Kod blokları syntax highlighting
// Tool çağrı kartları (ToolExecutionCard) inline
// Zaman damgası
```

- [ ] **Step 2: StreamingText bileşeni yaz**

```typescript
// deltaContent parçalarını birleştir
// Yanıp sönen cursor animasyonu
// Otomatik scroll-to-bottom
```

- [ ] **Step 3: ChatInput bileşeni yaz**

```typescript
// Multi-line TextInput
// Gönder butonu (streaming sırasında → Abort butonu)
// Klavye yönetimi (KeyboardAvoidingView)
```

- [ ] **Step 4: PermissionDialog bileşeni yaz**

```typescript
// Modal overlay
// İzin detayları: tool adı, dosya adı, komut
// Approve / Deny butonları
// Haptic feedback
// Auto-dismiss (30 saniye timeout → deny)
```

- [ ] **Step 5: Ana Chat ekranını birleştir**

`app/(tabs)/chat.tsx`:
```typescript
// FlatList ile mesaj listesi
// Altta ChatInput
// PermissionDialog (koşullu)
// Streaming durumu göstergesi
// Boş durum: "Mesaj gönderin" placeholder
```

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: chat ekranı, streaming ve permission dialog"
```

---

## Task 9: Mobile App — Ayarlar ve Session Yönetimi

**Files:**
- Create: `apps/mobile/app/(tabs)/settings.tsx`
- Create: `apps/mobile/app/(tabs)/sessions.tsx`
- Create: `apps/mobile/components/ModelSelector.tsx`
- Create: `apps/mobile/components/EffortSelector.tsx`

- [ ] **Step 1: Model seçici bileşeni yaz**

```typescript
// Bridge server'dan model listesini al
// Picker/Select UI
// Seçim → settings store güncelle → bridge server'a bildir
```

- [ ] **Step 2: Effort seçici bileşeni yaz**

```typescript
// Segmented control: Low / Medium / High / XHigh
// Görsel gösterge (hız vs kalite trade-off)
```

- [ ] **Step 3: Settings ekranı yaz**

```typescript
// Model seçimi
// Reasoning effort
// Auto-approve reads toggle
// Bağlantı bilgileri (IP, port, durum)
// Bağlantıyı kes butonu
// Uygulama sürümü
```

- [ ] **Step 4: Sessions ekranı yaz**

```typescript
// Session listesi (FlatList)
// Her session: ID, oluşturulma tarihi, son mesaj, model
// Yeni session oluştur butonu
// Session'a dokunma → chat'e geç
// Sola kaydır → sil
```

- [ ] **Step 5: Tab navigator kur**

`app/(tabs)/_layout.tsx`:
```typescript
// Tab'lar: Chat | Sessions | Settings
// İkonlar: MessageCircle | List | Settings
// Bağlantı durumu header'da göster
```

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: ayarlar, model seçimi ve session yönetimi"
```

---

## Task 10: Uçtan Uca Entegrasyon ve Test

**Files:**
- Modify: `apps/bridge-server/src/server.ts`
- Modify: `apps/mobile/app/pair.tsx`

- [ ] **Step 1: Bridge server'ı tam fonksiyonel hale getir**

Tüm modülleri `server.ts`'de birleştir:
```typescript
// 1. Copilot CLI başlat
// 2. WS sunucu başlat
// 3. QR kod göster
// 4. Pairing dinle
// 5. Session yönetim endpoint'lerini aç
```

- [ ] **Step 2: Bridge server'ı başlat ve test et**

```bash
cd apps/bridge-server
pnpm dev
```

Beklenen:
- Terminal'de QR kod görünür
- `ws://LOCAL_IP:9876` dinler
- Log: "Bridge Server hazır, QR kodunu okutun"

- [ ] **Step 3: Mobile app'i başlat ve test et**

```bash
cd apps/mobile
npx expo start
```

Test senaryosu:
1. QR kodu telefon ile oku
2. Bağlantı kurulur
3. Chat ekranında mesaj gönder: "Merhaba"
4. Streaming yanıt görüntülenir
5. Tool çağrısı gelince permission dialog açılır
6. Approve → tool çalışır → sonuç gösterilir

- [ ] **Step 4: Hata senaryolarını test et**

- Bağlantı kopma → reconnect
- Geçersiz QR → hata mesajı
- Session timeout → yeniden session oluşturma
- Permission deny → tool iptal

- [ ] **Step 5: Son commit**

```bash
git add -A && git commit -m "feat: uçtan uca entegrasyon tamamlandı — MVP v0.1"
```

---

## Bağımlılık Grafiği

```
Task 1 (Monorepo) ─────────────┐
                                ├──► Task 5 (Mobile Setup) ──► Task 6 (WS Client + Stores)
Task 2 (Copilot SDK) ──┐       │                               │
                        ├──► Task 4 (QR + Auth)                 ├──► Task 7 (QR Screen)
Task 3 (WS Server) ────┘       │                               ├──► Task 8 (Chat Screen)
                                │                               └──► Task 9 (Settings)
                                │
                                └──────────────────────────────────────► Task 10 (Integration)
```

**Paralel çalışılabilir task'lar:**
- Task 2 + Task 3 (Bridge server bileşenleri)
- Task 5 + Task 4 (Mobile setup + Auth)
- Task 7 + Task 8 + Task 9 (Mobile ekranlar — Task 6'dan sonra)

---

## Notlar

- Copilot SDK public preview'da — API değişikliklerini takip et
- Her task sonunda çalışır durumda olmalı (incremental delivery)
- Bridge server'ın `@github/copilot-sdk` bağımlılığını `^0.2.2` olarak kilitle
- React Native sürümünü Expo SDK'nın desteklediği ile uyumlu tut
- TypeScript strict mode her yerde aktif
