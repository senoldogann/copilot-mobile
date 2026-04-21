# Copilot Mobile

Masaüstü bilgisayarınızdaki GitHub Copilot oturumunu telefonunuzdan kullanmanızı sağlayan mobil uygulama. Evde olmadığınızda da kod yazabilirsiniz.

## Nasıl Çalışır

```text
┌──────────────┐       WSS        ┌────────────────┐    JSON-RPC    ┌─────────────┐
│  Mobile App  │ ◄──────────────► │  Bridge Server │ ◄────────────► │ Copilot CLI │
│ (React Native)│   QR Pairing    │   (Node.js)    │                │  (Desktop)  │
└──────────────┘                  └────────────────┘                └─────────────┘
```

1. **Bridge Server** masaüstünde çalışır, `@github/copilot-sdk` üzerinden Copilot CLI ile konuşur
2. Terminal'de QR kod gösterilir
3. **Mobil uygulama** QR kodu tarar → public relay veya reverse-proxy URL üzerinden bridge'e bağlanır
4. Telefondan mesaj yazarsınız, Copilot yanıt verir

## Masaüstünde Devam Etme

- Telefondan başlattığınız oturumlar Copilot CLI'nin yerel oturum deposuna yazılır.
- Bridge yeni oturumları repo köküne bağlı bir çalışma diziniyle açar; böylece monorepo alt paketine sıkışmaz ve masaüstü VS Code tarafında aynı proje altında görünür.
- Aynı makinede VS Code terminalinden `copilot /resume` çalıştırarak telefonda başlattığınız sohbeti devam ettirebilirsiniz.
- Mobil uygulama foreground'a döndüğünde ve sohbet çekmecesi açıldığında oturum listesini yeniden ister; masaüstünde açılan oturumlar da bu şekilde telefona geri yansır.

## Gereksinimler

- Node.js ≥ 20
- pnpm ≥ 9
- GitHub Copilot hesabı (CLI üzerinden oturum açılmış)
- iOS veya Android cihaz (Expo Go veya development build)
- Dış ağ erişimi için public bir relay veya reverse-proxy WebSocket URL gerekir

## Kurulum

```bash
# Bağımlılıkları kur
pnpm install
```

## Kullanım

### 1. Public Relay veya Reverse Proxy URL'ini Hazırla

```bash
export COPILOT_MOBILE_PUBLIC_WS_URL="wss://your-tunnel.example.com"
```

Bu URL yerelde çalışan bridge server'a veya relay katmanına gitmelidir. Farklı port kullanıyorsanız aynı değeri `BRIDGE_PORT` ile bridge'e de verin.

Kendi relay sunucunuzu çalıştırmak isterseniz:

```bash
export COPILOT_MOBILE_RELAY_SECRET="replace-with-a-long-random-secret"
pnpm dev:relay
export COPILOT_MOBILE_RELAY_URL="ws://127.0.0.1:8787"
```

Bridge bu modda companion olarak relay'e outbound bağlanır ve QR içinde mobil için `.../connect/mobile/<companionId>` URL'i üretir.

Hosted relay deploy notları için [docs/relay-deployment.md](/Users/dogan/Desktop/copilot-mobile/docs/relay-deployment.md) dosyasına bakın.

Örnek:

```bash
export BRIDGE_PORT=8443
export COPILOT_MOBILE_PUBLIC_WS_URL="wss://your-tunnel.example.com"
```

`copilot-mobile up` komutu `COPILOT_MOBILE_RELAY_URL` yoksa `COPILOT_MOBILE_PUBLIC_WS_URL` bekler.

### 1a. Local Companion Stack

Aynı ağ içinde relay tabanlı companion akışını tek komutta ayağa kaldırmak için:

```bash
pnpm dev:companion:local
```

Bu komut local relay server, bridge server ve browser companion dashboard'unu birlikte başlatır; ardından taze pairing QR kodunu üretir.

Native bir macOS companion shell açmak isterseniz:

```bash
pnpm dev:companion:macos
```

Bu shell mevcut localhost dashboard'u embed eder, bridge durumunu sürekli poll eder ve `pnpm dev:companion:local` ile `pnpm dev:bridge:direct` süreçlerini kendi içinden yönetebilir.

### 2. `copilot-mobile up` Çalıştır

```bash
pnpm copilot-mobile up
```

Bu CLI şu anda repo içi bir yönetim komutu olarak tasarlandı. En doğru kullanım şekli `pnpm copilot-mobile <komut>` veya eşdeğer root script'leridir.

Bridge arka planda başlar, `@copilot-mobile/shared` ve `@copilot-mobile/bridge-server` paketlerini build eder, sonra terminale yeni pairing QR kodunu basar.

Diğer CLI komutları:

```bash
pnpm copilot-mobile status
pnpm copilot-mobile qr
pnpm copilot-mobile dashboard
pnpm copilot-mobile down
```

İsterseniz aynı komutları root package script'leriyle de çalıştırabilirsiniz:

```bash
pnpm bridge:up
pnpm bridge:status
pnpm bridge:qr
pnpm bridge:down
```

### 3. Mobil Uygulamayı Başlat

```bash
pnpm dev:mobile
```

Expo Dev Client açılır. iOS Simulator, Android Emulator veya fiziksel cihazda çalıştırın.

### 4. QR ile Eşleştir

1. Mobil uygulamada **"QR ile Bağlan"** butonuna basın
2. Kamerayı terminal'deki QR koda tutun
3. Bağlantı kurulunca **"Sohbet"** ekranına geçin
4. Kod yazın!

## Proje Yapısı

```text
copilot-mobile/
├── packages/
│   └── shared/              # Protokol tipleri, Zod şemaları, adapter arayüzleri
├── apps/
│   ├── bridge-server/       # WS bridge server (Node.js + copilot-sdk)
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
| `pnpm copilot-mobile up` | Bridge'i arka planda başlat, build al ve pairing QR üret |
| `pnpm copilot-mobile status` | Çalışan bridge sürecini ve public URL bilgisini göster |
| `pnpm copilot-mobile qr` | Yeni pairing QR kodu üret |
| `pnpm copilot-mobile dashboard` | Localhost companion dashboard'unu aç |
| `pnpm copilot-mobile down` | Arka plan bridge sürecini durdur |
| `pnpm dev:companion:macos` | Native macOS companion shell aç |
| `pnpm dev:mobile` | Mobil uygulamayı başlat |
| `pnpm build:shared` | Shared paketi derle |
| `pnpm build:bridge` | Bridge server'ı derle |
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

- Relay kullanıyorsanız `COPILOT_MOBILE_RELAY_URL`, reverse-proxy kullanıyorsanız `COPILOT_MOBILE_PUBLIC_WS_URL` ayarlayın.
- Hosted relay kullanıyorsanız bridge ve relay server aynı `COPILOT_MOBILE_RELAY_SECRET` değerini paylaşmalıdır.
- `status` ve `qr` komutları bridge içindeki localhost management endpoint'lerine bağlanır; bu endpoint'ler dış ağdan erişilemez.
- `dashboard` komutu aynı localhost management endpoint'lerini kullanan browser tabanlı companion yüzeyini açar.
- `dev:companion:macos` komutu aynı management endpoint'lerini native bir macOS shell içinden kullanır; bridge lifecycle, QR ve dashboard görüntüsünü tek pencerede toplar.
- Public `wss://` URL'ler `transportMode: "relay"` olarak advertise edilir; direct mod yalnızca private-network `ws://` URL'ler için kullanılır.
- Session completion için local notifications dev build veya production build içinde, kullanıcı izin verdiyse çalışır. Expo Go remote push akışını desteklemez.
- Voice dictation `expo-speech-recognition` ile development build gerektirir; Expo Go içinde native modül yüklenmez. `app.json` içinde plugin iOS (`NSMicrophoneUsageDescription`, `NSSpeechRecognitionUsageDescription`) ve Android (`RECORD_AUDIO`, Google quick search box paket görünürlüğü) izinlerini otomatik ekler. Dev build almak için: `pnpm --filter @copilot-mobile/mobile expo prebuild --clean` ardından `pnpm --filter @copilot-mobile/mobile expo run:ios` veya `run:android`. Dil varsayılan olarak `en-US`; başka locale'ler için `ChatInput` içindeki `startVoiceDictation({ lang })` argümanı güncellenir.

## Teknoloji

- **Shared**: TypeScript, Zod
- **Bridge Server**: Node.js, ws, jsonwebtoken, @github/copilot-sdk
- **Mobile**: Expo 54, React Native 0.81.5, Expo Router 6, Zustand 5, expo-camera, expo-secure-store

## Test Notu

- `pnpm test` artık mock kullanmaz; gerçek Copilot CLI entegrasyonunu doğrular
- Bunun için GitHub hesabınızın CLI üzerinde açık olması gerekir
- Gerekirse önce `gh auth login` çalıştırın ve Copilot CLI erişiminin hazır olduğundan emin olun
