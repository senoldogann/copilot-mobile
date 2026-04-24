# Code Companion

Kendi Mac'inizde çalışan kodlama oturumunu telefonunuzdan kullanmanızı sağlayan mobil companion uygulaması.

## Nasıl Çalışır

```text
┌──────────────┐       WSS        ┌────────────────┐    JSON-RPC    ┌─────────────┐
│  Mobile App  │ ◄──────────────► │  Bridge Server │ ◄────────────► │ Copilot CLI │
│ (React Native)│   QR Pairing    │   (Node.js)    │                │  (Desktop)  │
└──────────────┘                  └────────────────┘                └─────────────┘
```

1. **Desktop companion daemon** masaüstünde `LaunchAgent` olarak çalışır ve `@github/copilot-sdk` üzerinden Copilot CLI ile konuşur
2. `code-companion up` terminalde pairing QR üretir
3. **Mobil uygulama** QR kodu tarar → hosted relay/control-plane veya self-hosted relay üzerinden companion'a bağlanır
4. Telefondan mesaj yazarsınız, Mac'inizdeki oturum yanıt verir

## Masaüstünde Devam Etme

- Telefondan başlattığınız oturumlar Copilot CLI'nin yerel oturum deposuna yazılır.
- Bridge yeni oturumları repo köküne bağlı bir çalışma diziniyle açar; böylece monorepo alt paketine sıkışmaz ve masaüstü VS Code tarafında aynı proje altında görünür.
- Aynı makinede VS Code terminalinden `copilot /resume` çalıştırarak telefonda başlattığınız sohbeti devam ettirebilirsiniz.
- Mobil uygulama foreground'a döndüğünde ve sohbet çekmecesi açıldığında oturum listesini yeniden ister; masaüstünde açılan oturumlar da bu şekilde telefona geri yansır.

## Gereksinimler

- macOS çalışan bir bilgisayar
- Node.js ≥ 20
- pnpm ≥ 9
- OpenSSL — TLS sertifikası üretimi için gereklidir (doğrudan eşleştirme). macOS için: `brew install openssl`; Debian/Ubuntu için: `sudo apt-get install openssl`. Alternatif olarak manuel olarak `cert.pem` ve `key.pem` dosyalarını `~/.code-companion/` dizinine yerleştirebilirsiniz.
- GitHub Copilot hesabı ve masaüstünde giriş yapılmış Copilot CLI
- iOS veya Android cihaz
- Dış ağ erişimi için public bir relay/control-plane deployment'ı

Son kullanıcı akışında ekstra masaüstü kurulumu şudur:

1. Mac'e `npm install -g code-companion`
2. Bir kez `code-companion login`
3. Servisi başlatmak için `code-companion up`
4. Telefonda QR taratıp eşleştirmek

Bir kez eşleştirdikten sonra Mac açık, kullanıcı oturumu aktif ve companion sağlıklı kaldığı sürece servis LaunchAgent üzerinden arka planda çalışmaya devam eder. Telefonun aynı ağda olması gerekmez; hosted relay kullanıldığında farklı ağdan reconnect desteklenir.

## Kurulum

```bash
# Bağımlılıkları kur
pnpm install
```

## Kullanım

### 1. Desktop companion login

Global npm kurulumunda hedef akış:

```bash
npm install -g code-companion
code-companion login
code-companion up
code-companion doctor
```

`code-companion login` resmi Copilot CLI `copilot login` akışını çalıştırır. `up` komutu macOS altında `~/Library/LaunchAgents/dev.senoldogan.codecompanion.bridge.plist` yazar, daemon'ı arka planda başlatır ve pairing QR'ı doğrudan terminale basar. `doctor` komutu Copilot auth, LaunchAgent, daemon bundle, relay linki ve localhost management health sinyallerini tek ekranda doğrular.

Repo içinden test ederken aynı komutları `node ./bin/copilot-mobile.mjs <komut>` veya `pnpm code-companion <komut>` ile de çalıştırabilirsiniz.

### 2. Hosted relay veya local control-plane hazırla

V1 companion varsayılan olarak hosted mode ile açılır. Repo içinde local smoke test için aynı makinede relay/control-plane açabilirsiniz:

```bash
export CODE_COMPANION_SELF_HOSTED_RELAY_SECRET="replace-with-a-long-random-secret"
pnpm dev:relay
code-companion up
```

Bu durumda `code-companion up` varsayılan local hosted endpoint'i `http://127.0.0.1:8787` üzerinden companion registration + session alır ve QR içinde relay route üretir.

Gerçek remote kullanım için önerilen yol Cloudflare Workers relay'dir. Ayrıntılı kurulum:

- [docs/cloudflare-relay.md](/Users/dogan/Desktop/copilot-mobile/docs/cloudflare-relay.md)

Özet komutlar:

```bash
pnpm --filter @copilot-mobile/cloudflare-relay exec wrangler login
pnpm --filter @copilot-mobile/cloudflare-relay exec wrangler secret put RELAY_SECRET
pnpm --filter @copilot-mobile/cloudflare-relay exec wrangler secret put CONTROL_PLANE_SECRET
pnpm --filter @copilot-mobile/cloudflare-relay exec wrangler deploy
```

Deploy sonrası masaüstünde:

```bash
code-companion up
```

Bu repo artık varsayılan olarak şu hosted Worker URL'ini kullanır:

```bash
https://copilot-mobile-relay.senoldogan0233.workers.dev
```

Bu yüzden normal kullanıcı akışında ek `export` gerekmez.

Self-hosted legacy relay modu hala desteklenir, fakat artık varsayılan tüketici akışı değildir.

### 3. Mobil uygulamayı başlat

```bash
pnpm dev:mobile
```

Bu komut artık Expo Dev Client için Metro'yu `tunnel` modunda açar. Böylece fiziksel telefon farklı ağda veya 5G'deyken de development bundle'ı çekebilir.

### 4. QR ile eşleştir

1. Mobil uygulamada **"QR ile Bağlan"** butonuna basın
2. Kamerayı `code-companion up` terminal çıktısındaki QR koda tutun
3. Bağlantı kurulunca **"Sohbet"** ekranına geçin
4. Kod yazın!

## Proje Yapısı

```text
copilot-mobile/
├── packages/
│   └── shared/              # Protokol tipleri, Zod şemaları, adapter arayüzleri
├── apps/
│   ├── bridge-server/       # WS bridge server (Node.js + copilot-sdk)
│   ├── cloudflare-relay/    # Hosted relay/control-plane (Cloudflare Workers)
│   │   ├── src/
│   │   │   ├── server.ts        # Giriş noktası
│   │   │   ├── ws/              # WebSocket server + mesaj yönlendirici
│   │   │   ├── copilot/         # SDK adapter + session yönetimi
│   │   │   ├── auth/            # TLS, JWT, pairing, QR
│   │   │   └── utils/           # Rate limit, mesaj ID, network
│   │   └── tests/               # Integration testleri
│   └── mobile/              # React Native/Expo mobil uygulama
│       └── app/                 # Expo Router ekranları (index, scan, chat, settings)
```

## Komutlar

| Komut | Açıklama |
| ----- | -------- |
| `code-companion login` | Resmi Copilot CLI login akışını çalıştır |
| `code-companion up` | LaunchAgent'i kur/yenile, daemon'ı başlat ve terminalde pairing QR üret |
| `code-companion status` | Daemon, Copilot auth, relay ve last error durumunu göster |
| `code-companion doctor` | Companion'ın production-ready pairing ve reconnect için hazır olup olmadığını denetle |
| `code-companion qr` | Çalışan daemon'dan yeni pairing QR iste |
| `code-companion logs` | Daemon stderr logunu tail et |
| `code-companion dashboard` | Local dashboard URL'ini yazdır |
| `code-companion down` | LaunchAgent'i unload et ve daemon'ı durdur |
| `pnpm dev:companion:macos` | Native macOS companion shell aç |
| `pnpm dev:relay:cloudflare` | Cloudflare Worker relay'i local dev modda aç |
| `pnpm deploy:relay:cloudflare` | Cloudflare Worker relay'i deploy et |
| `pnpm dev:mobile` | Mobil uygulamayı başlat |
| `pnpm build:shared` | Shared paketi derle |
| `pnpm build:bridge` | Bridge server'ı derle |
| `pnpm build:desktop` | Publishable desktop daemon bundle'ını üret |
| `pnpm build:companion:macos` | Native macOS companion shell'i derle |
| `pnpm typecheck` | Tüm paketlerde tip kontrolü |
| `pnpm test` | Gerçek Copilot CLI ile E2E testlerini çalıştır |

## Güvenlik

- **WS Transport**: Public relay veya reverse-proxy bridge'e WebSocket trafiğini taşır; pairing ve JWT auth bridge seviyesinde uygulanır
- **QR Pairing**: Tek kullanımlık token, 2 dakika TTL
- **JWT Auth**: HS256, 24 saat TTL, reconnect desteği
- **Rate Limiting**: Pairing (5/5dk), mesaj (30/dk) sliding window
- **Replay Protection**: 5 dakikalık pencerede aynı mesaj ID reddedilir
- **Tek İstemci**: Bridge server aynı anda yalnızca bir mobil cihaz kabul eder

## Runtime Notları

- macOS companion config dosyası `~/.code-companion/config.json` altında tutulur. Legacy `~/.copilot-mobile/config.json` ilk okumada migrate edilir.
- Varsayılan background servis `launchctl bootstrap gui/<uid>` ile yüklenen user `LaunchAgent` modelidir.
- Hosted relay kullanıyorsanız public API ve public relay base URL değerlerini `CODE_COMPANION_HOSTED_API_BASE_URL` ve `CODE_COMPANION_HOSTED_RELAY_BASE_URL` ile verebilirsiniz.
- Local smoke test için `pnpm dev:relay` açıp aynı makinede hosted-flow'u deneyebilirsiniz; bu durumda relay tarafı `CODE_COMPANION_SELF_HOSTED_RELAY_SECRET` bekler.
- `status` ve `qr` komutları daemon içindeki localhost management endpoint'lerine bağlanır; bu endpoint'ler dış ağdan erişilemez.
- `doctor` komutu localhost health endpoint'ini, LaunchAgent dosyasını, daemon bundle'ını ve Copilot CLI auth durumunu birlikte doğrular. CI veya destek akışı için `code-companion doctor --json` kullanılabilir.
- Dashboard browser yüzeyi aynı management endpoint'lerini kullanır ve QR yenileme, logs açma, servis durdurma aksiyonlarını buradan verir.
- `dev:companion:macos` komutu aynı management endpoint'lerini native bir macOS shell içinden kullanır; bridge lifecycle, QR ve dashboard görüntüsünü tek pencerede toplar.
- Public relay tabanlı companion QR'ları `transportMode: "relay"` ile advertise edilir; legacy direct mod yalnızca private-network debug akışı için tutulur.
- Session completion için local notifications dev build veya production build içinde, kullanıcı izin verdiyse çalışır. Expo Go remote push akışını desteklemez.
- Voice dictation `expo-speech-recognition` ile development build gerektirir; Expo Go içinde native modül yüklenmez. `app.json` içinde plugin iOS (`NSMicrophoneUsageDescription`, `NSSpeechRecognitionUsageDescription`) ve Android (`RECORD_AUDIO`, Google quick search box paket görünürlüğü) izinlerini otomatik ekler. Dev build almak için: `pnpm --filter @copilot-mobile/mobile expo prebuild --clean` ardından `pnpm --filter @copilot-mobile/mobile expo run:ios` veya `run:android`. Dil varsayılan olarak `en-US`; başka locale'ler için `ChatInput` içindeki `startVoiceDictation({ lang })` argümanı güncellenir.
- `@github/copilot` paketinin JS fallback yolu Node.js 24 isteyebilir; normal global kurulumda platform binary çözüldüğünde companion akışı Node.js 20+ ile çalışır. Bu yüzden destek ve release kontrolünde `code-companion doctor` çıktısı esas alınmalıdır.

Production ve App Store öncesi release checklist'i için:

- [docs/project-runbook-and-appstore-readiness.md](/Users/dogan/Desktop/copilot-mobile/docs/project-runbook-and-appstore-readiness.md)

## Teknoloji

- **Shared**: TypeScript, Zod
- **Bridge Server**: Node.js, ws, jsonwebtoken, @github/copilot-sdk
- **Mobile**: Expo 54, React Native 0.81.5, Expo Router 6, Zustand 5, expo-camera, expo-secure-store

## Test Notu

- `pnpm test` artık mock kullanmaz; gerçek Copilot CLI entegrasyonunu doğrular
- Bunun için GitHub hesabınızın CLI üzerinde açık olması gerekir
- Gerekirse önce `gh auth login` çalıştırın ve Copilot CLI erişiminin hazır olduğundan emin olun
