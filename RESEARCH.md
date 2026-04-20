# VS Code & GitHub Copilot Mobile Bridge — Teknik Araştırma Raporu

**Tarih:** 20 Nisan 2026  
**Amaç:** Mobil cihazdan VS Code ve GitHub Copilot'a erişim sağlayan bir bridge uygulama için teknik fizibilite

---

## 1. VS Code Remote Mimari

### 1.1 Extension Host Süreci

VS Code iki tür extension'ı ayırır:

| Tür | Çalışma Yeri | Örnek |
|-----|-------------|-------|
| **UI Extensions** | Her zaman yerel (kullanıcı makinesi) | Temalar, snippet'ler, keybinding'ler |
| **Workspace Extensions** | Workspace'in bulunduğu makine | Dil servisleri, debugger'lar, dosya operasyonları |

- **Local Extension Host**: UI extension'ları barındırır
- **Remote Extension Host**: VS Code Server içinde çalışır, workspace extension'ları barındırır
- Extension'lar arası iletişim **VS Code Commands** üzerinden yapılır (JSON stringify/parse ile serileştirme)

### 1.2 VS Code Server

- Uzak makineye otomatik yüklenen bir backend server bileşeni
- Non-Electron, standart Node.js üzerinde çalışır
- Remote Development, Codespaces ve Tunnels tarafından kullanılır
- **Tek kullanıcı erişimi** — eş zamanlı çoklu kullanıcı desteklemez
- Lisans gereği **servis olarak barındırılamaz**

### 1.3 VS Code Tunnel Mimarisi

```
┌──────────────┐     ┌─────────────────────┐     ┌──────────────────┐
│  VS Code     │────▶│  Microsoft Dev      │◀────│  VS Code Server  │
│  Client      │     │  Tunnels Service    │     │  (Uzak Makine)   │
│  (vscode.dev │     │  (Azure hosted)     │     │                  │
│   veya       │     │                     │     │  code tunnel     │
│   Desktop)   │     └─────────────────────┘     └──────────────────┘
└──────────────┘
```

**Önemli detaylar:**

- `code tunnel` CLI komutu uzak makinede VS Code Server'ı başlatır
- **Microsoft Dev Tunnels** üzerinden relay bağlantısı kurar
- GitHub veya Microsoft hesabı ile OAuth authentication gerektirir
- SSH tüneli üzerinden **AES-256 CTR** ile uçtan uca şifreleme sağlar
- Açık kaynak: [github.com/microsoft/dev-tunnels](https://github.com/microsoft/dev-tunnels)
- `code tunnel service install` ile sistem servisi olarak çalıştırılabilir
- Her tunnel'a `https://vscode.dev/tunnel/<machine_name>/<folder_name>` URL'si ile erişim
- Bir makinede maksimum **10 tunnel** kaydı
- Bağlantı `global.rel.tunnels.api.visualstudio.com` domain'i üzerinden

### 1.4 Dev Tunnels Protokolü

- **Tunnel Relay Service**: Bulut tabanlı relay, firewall arkasındaki host'lara erişim
- **Duplex stream**: İstemci ve host arasında TCP/UDP bağlantı
- Bir tunnel birden fazla port'u aynı anda destekler
- Her port farklı protokol (HTTP, HTTPS) ve erişim kontrolü alabilir

---

## 2. GitHub Copilot Extension İç Yapısı

### 2.1 Copilot Chat Extension Manifest'i

Analiz edilen: `github.copilot-chat-0.44.1/package.json`

**Temel bilgiler:**
- **ID**: `github.copilot-chat`
- **Engine**: VS Code `^1.116.0`, Node.js `>=22.14.0`
- **Aktivasyon**: `onStartupFinished`, `onLanguageModelChat:copilot`, `onUri`
- **Ana dosya**: `./dist/extension` (minified/bundled)

**Kullandığı proposed API'lar (kritik olanlar):**
- `defaultChatParticipant` — varsayılan chat katılımcısı
- `chatParticipantPrivate` — gizli chat API'ları
- `chatProvider` — chat sağlayıcı
- `languageModelSystem` — dil modeli sistem erişimi
- `languageModelCapabilities` — model yetenek sorgusu
- `resolvers` — uzak bağlantı çözümleme
- `dataChannels` — veri kanalları
- `mcpServerDefinitions` — MCP sunucu tanımları
- `chatSessionsProvider` — oturum yönetimi
- `embeddings` — vektör gömmeleri

**Kayıtlı Tool'lar:**
- `copilot_searchCodebase` — workspace'te semantik arama
- `execution_subagent` — komut çalıştırma alt ajanı
- `search_subagent` — kod arama alt ajanı
- `copilot_searchWorkspaceSymbols` — sembol arama
- `copilot_getVSCodeAPI` — VS Code API dokümantasyonu
- `copilot_findFiles` — dosya arama

### 2.2 Copilot Authentication

- VS Code'un yerleşik `AuthenticationProvider` API'sini kullanır
- GitHub OAuth üzerinden token alır
- Token'lar `SecretStorage` API ile güvenli depolanır (Electron `safeStorage`)
- `vscode.window.registerUriHandler` ile OAuth callback URI'ları işler
- URI şeması: `vscode://` (desktop) veya `https://*.github.dev` (web)

### 2.3 Copilot İletişim Protokolleri

Copilot Chat extension **doğrudan** GitHub API'larıyla iletişim kurar:
- Language Model API üzerinden model erişimi (`vscode.lm.selectChatModels`)
- Chat Participant API üzerinden kullanıcı etkileşimi
- Streaming tabanlı yanıtlar (`LanguageModelChatResponse`)
- Tool calling desteği ile otonom agent davranışı

---

## 3. VS Code Extensibility API'ları (Copilot ile İlgili)

### 3.1 Language Model API

```typescript
// Model seçimi
const models = await vscode.lm.selectChatModels({ vendor: 'copilot' });

// İstek gönderme
const response = await model.sendRequest(messages, options, token);

// Streaming yanıt
for await (const fragment of response.text) {
  // Her parçayı işle
}
```

- Desteklenen modeller: `gpt-4o`, `gpt-4o-mini`, `o1`, `claude-3.5-sonnet`
- Rate limiting uygulanır
- Kullanıcı rızası gerektirir (authentication dialog)

### 3.2 Chat Participant API

Extension'lar chat'e özelleştirilmiş katılımcılar ekleyebilir:
- `@` sözdizimi ile çağırma
- `/` slash komutları
- Streaming markdown yanıtlar
- Butonlar, dosya ağaçları, referanslar
- Tool calling desteği

### 3.3 MCP (Model Context Protocol)

- Açık standart: AI modellerini araç ve veri kaynaklarına bağlar
- VS Code, JetBrains, CLI, web genelinde çalışır
- Yerel ve uzak MCP sunucuları desteklenir
- GitHub MCP Server yerleşik olarak sağlanır

---

## 4. GitHub Copilot SDK (`@github/copilot-sdk`)

### 4.1 Genel Bilgi

**Bu, mobil bridge için en kritik keşif.**

- **Paket**: `@github/copilot-sdk` (v0.2.2, MIT lisanslı, public preview)
- **Protokol**: JSON-RPC üzerinden Copilot CLI ile iletişim
- **Transport**: Stdio veya TCP
- **Bağımlılık**: GitHub Copilot CLI'ın PATH'te bulunması gerekir

### 4.2 Mimari

```
┌──────────────────┐     JSON-RPC      ┌──────────────────┐
│  Sizin Uygulamanız│ ◄──────────────► │  Copilot CLI     │
│  (CopilotClient) │    stdio/TCP      │  (Arka plan      │
│                  │                   │   sunucusu)       │
│                  │                   │                  │
│  - createSession │                   │  - Model erişimi │
│  - send/receive  │                   │  - Tool çağrıları│
│  - tool tanımla  │                   │  - Dosya işlemleri│
└──────────────────┘                   └──────────────────┘
```

### 4.3 Temel API

```typescript
import { CopilotClient, approveAll } from "@github/copilot-sdk";

const client = new CopilotClient({
  githubToken: "...",           // GitHub token ile auth
  useStdio: true,               // veya TCP bağlantı
  cliUrl: "localhost:8080",      // mevcut CLI'a bağlan
  port: 0,                      // rastgele port
});

await client.start();

const session = await client.createSession({
  model: "gpt-5",               // veya claude-sonnet-4.5
  onPermissionRequest: approveAll,
  streaming: true,
});

// Streaming yanıt
session.on("assistant.message_delta", (event) => {
  process.stdout.write(event.data.deltaContent);
});

await session.send({ prompt: "What is 2+2?" });
```

### 4.4 Kritik Yetenekler

| Özellik | Durum | Açıklama |
|---------|-------|----------|
| Oturum yönetimi | ✅ | Create, resume, list, delete |
| Streaming | ✅ | Delta mesajlar ile gerçek zamanlı |
| Custom tool'lar | ✅ | Zod şemalı tool tanımlama |
| Dosya ekleri | ✅ | Resim dahil dosya gönderme |
| BYOK (Custom provider) | ✅ | OpenAI, Azure, Anthropic, Ollama |
| Infinite sessions | ✅ | Otomatik context compaction |
| UI Elicitation | ✅ | Form tabanlı UI dialog'ları |
| Multi-session | ✅ | Bağımsız paralel oturumlar |
| Uzak CLI'a bağlanma | ✅ | `cliUrl` ile mevcut sunucuya bağlanma |
| Telemetry | ✅ | OpenTelemetry entegrasyonu |

### 4.5 Authentication Seçenekleri

1. **GitHub Token**: `githubToken` parametresi ile doğrudan
2. **Logged-in user**: CLI'ın kendi auth'unu kullan (`useLoggedInUser: true`)
3. **Custom provider**: Kendi API anahtarınız ile (BYOK)

---

## 5. Mobil Bridge Mimari Önerileri

### Yaklaşım A: Copilot SDK + WebSocket Bridge (ÖNERİLEN)

```
┌────────────┐   WebSocket   ┌─────────────────┐   JSON-RPC   ┌──────────┐
│  Mobil App  │◄────────────►│  Bridge Server   │◄────────────►│ Copilot  │
│  (React    │               │  (Node.js)       │              │ CLI      │
│   Native / │               │                  │              │          │
│   Flutter) │               │  @github/        │              │          │
│            │               │  copilot-sdk     │              │          │
└────────────┘               └─────────────────┘              └──────────┘
```

**Avantajlar:**
- Copilot SDK tam programatik erişim sağlar
- Streaming, tool calling, session management yerleşik
- Bridge server'ı masaüstü makinede veya bulutta çalışabilir
- WebSocket ile düşük gecikme

**Gereksinimler:**
- Bridge server'da Copilot CLI kurulu olmalı
- GitHub authentication gerekli
- Dev Tunnels ile uzak erişim mümkün

### Yaklaşım B: VS Code Tunnel + vscode.dev Wrapper

```
┌────────────┐    HTTPS     ┌─────────────┐   Dev Tunnels   ┌──────────┐
│  Mobil App  │────────────►│  vscode.dev   │◄──────────────►│ VS Code  │
│  (WebView) │              │  (Microsoft   │                │ Server   │
│            │              │   hosted)     │                │ (Yerel)  │
└────────────┘              └─────────────┘                 └──────────┘
```

**Avantajlar:**
- Altyapı Microsoft tarafından sağlanır
- Tam VS Code deneyimi (Copilot dahil)
- Sıfır ek server geliştirme

**Dezavantajlar:**
- Mobil için optimize edilmemiş UI
- WebView sınırlamaları
- Özelleştirme kısıtlı

### Yaklaşım C: Custom Extension + Remote API

```
┌────────────┐   REST/WS    ┌─────────────────┐   Extension Host   ┌──────────┐
│  Mobil App  │◄───────────►│  Custom VS Code  │◄────────────────►│ Copilot  │
│            │              │  Extension       │                   │ Extension│
│            │              │  (HTTP server)   │                   │          │
└────────────┘              └─────────────────┘                   └──────────┘
```

**VS Code Extension içinde HTTP server açıp mobil app'in bağlanması.**

**Avantajlar:**
- Tam VS Code API erişimi
- Copilot Language Model API'ye doğrudan erişim

**Dezavantajlar:**
- Extension güvenlik kısıtlamaları
- Port forwarding gerekliliği
- Daha karmaşık geliştirme

---

## 6. Benzer Projeler ve Yaklaşımlar

| Proje | Yaklaşım | Durum |
|-------|---------|-------|
| **vscode.dev** | Tarayıcı tabanlı VS Code, tunnel ile uzak bağlantı | Resmi, aktif |
| **code-server** | Kendi sunucunuzda VS Code web | Açık kaynak (Coder) |
| **GitHub Codespaces** | Bulut tabanlı VS Code ortamı | Resmi, ücretli |
| **Copilot SDK** | Programatik Copilot erişimi | Public preview, MIT |
| **GitHub Mobile** | GitHub + Copilot Chat mobil uygulaması | Resmi, sınırlı |

---

## 7. Fizibilite Değerlendirmesi

### Teknik Fizibilite: ✅ YÜKSEK

**En uygun yaklaşım: Copilot SDK + WebSocket Bridge (Yaklaşım A)**

#### Neden:

1. **`@github/copilot-sdk`** tüm gerekli API'ları sağlar:
   - Programatik chat oturumları
   - Streaming yanıtlar
   - Tool calling (dosya okuma/yazma, komut çalıştırma)
   - Session persistence
   - Multi-model desteği

2. **Bridge server minimal**:
   - Node.js WebSocket server
   - SDK'yı wrap eden thin layer
   - Auth token forwarding

3. **Uzak erişim için mevcut altyapı**:
   - Dev Tunnels ile bridge server'a internet üzerinden erişim
   - Veya bulut sunucuda çalıştırma

### Riskler ve Sınırlamalar

| Risk | Seviye | Azaltma |
|------|--------|---------|
| SDK public preview, API değişebilir | Orta | Abstraction layer kullan |
| Copilot CLI bağımlılığı | Düşük | CLI'ı bridge server'a paketlenebilir |
| Rate limiting | Orta | İstek kuyrukları ve caching |
| Tek kullanıcı VS Code Server kısıtı | Düşük | Her kullanıcı kendi bridge'ini çalıştırır |
| Lisans kısıtlamaları | Düşük | SDK MIT lisanslı, kişisel kullanım için sorun yok |
| Gecikme (mobil ↔ server ↔ LLM) | Orta | Streaming ile algılanan gecikmeyi azalt |

---

## 8. Önerilen Uygulama Planı

### Faz 1: Bridge Server (MVP)
- Node.js + `@github/copilot-sdk` + WebSocket (socket.io veya ws)
- Temel chat: mesaj gönder, streaming yanıt al
- GitHub token ile authentication
- Session yönetimi (oluştur, devam et, listele)

### Faz 2: Mobil App (MVP)
- React Native veya Flutter
- Chat UI (streaming destekli)
- GitHub OAuth login
- Session geçmişi

### Faz 3: Gelişmiş Özellikler
- Dosya tarama ve düzenleme
- Terminal komut çalıştırma
- Tool approval UI
- Dev Tunnels entegrasyonu
- Çoklu workspace desteği

### Faz 4: Tam VS Code Entegrasyonu
- Custom VS Code extension ile derin entegrasyon
- Workspace dosya gezgini
- Diff görüntüleme
- Git operasyonları

---

## 9. Hızlı Başlangıç Komutu

```bash
mkdir copilot-bridge && cd copilot-bridge
npm init -y
npm install @github/copilot-sdk ws zod
```

```typescript
// Minimal bridge server
import { CopilotClient, approveAll } from "@github/copilot-sdk";
import { WebSocketServer } from "ws";

const client = new CopilotClient({ port: 0 });
await client.start();

const wss = new WebSocketServer({ port: 3001 });

wss.on("connection", async (ws) => {
  const session = await client.createSession({
    model: "gpt-5",
    streaming: true,
    onPermissionRequest: approveAll,
  });

  session.on("assistant.message_delta", (event) => {
    ws.send(JSON.stringify({ type: "delta", content: event.data.deltaContent }));
  });

  ws.on("message", async (data) => {
    const msg = JSON.parse(data.toString());
    await session.send({ prompt: msg.prompt });
  });
});
```

---

## Kaynaklar

- [VS Code Remote Architecture](https://code.visualstudio.com/api/advanced-topics/remote-extensions)
- [VS Code Tunnels](https://code.visualstudio.com/docs/remote/tunnels)
- [VS Code Server](https://code.visualstudio.com/docs/remote/vscode-server)
- [Chat Participant API](https://code.visualstudio.com/api/extension-guides/ai/chat)
- [Language Model API](https://code.visualstudio.com/api/extension-guides/ai/language-model)
- [Copilot SDK (npm)](https://www.npmjs.com/package/@github/copilot-sdk)
- [Dev Tunnels (open source)](https://github.com/microsoft/dev-tunnels)
- [MCP Protokolü](https://modelcontextprotocol.io/introduction)
