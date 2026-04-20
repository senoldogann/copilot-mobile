# Copilot Mobile

Masaüstü bilgisayarınızdaki GitHub Copilot oturumunu telefonunuzdan kullanmanızı sağlayan mobil uygulama. Evde olmadığınızda da kod yazabilirsiniz.

## Nasıl Çalışır

```
┌──────────────┐       WSS        ┌────────────────┐    JSON-RPC    ┌─────────────┐
│  Mobile App  │ ◄──────────────► │  Bridge Server │ ◄────────────► │ Copilot CLI │
│ (React Native)│   QR Pairing    │   (Node.js)    │                │  (Desktop)  │
└──────────────┘                  └────────────────┘                └─────────────┘
```

1. **Bridge Server** masaüstünde çalışır, `@github/copilot-sdk` üzerinden Copilot CLI ile konuşur
2. Terminal'de QR kod gösterilir
3. **Mobil uygulama** QR kodu tarar → WSS ile bridge'e bağlanır
4. Telefondan mesaj yazarsınız, Copilot yanıt verir

## Gereksinimler

- Node.js ≥ 20
- pnpm ≥ 9
- GitHub Copilot hesabı (CLI üzerinden oturum açılmış)
- iOS veya Android cihaz (Expo Go veya development build)
- Aynı yerel ağda olmanız gerekir (telefon + bilgisayar)

## Kurulum

```bash
# Bağımlılıkları kur
pnpm install

# Shared paketini derle (bridge server buna bağımlı)
pnpm build:shared
```

## Kullanım

### 1. Bridge Server'ı Başlat

```bash
pnpm dev:bridge
```

Terminal'de QR kod görünecek. Server `ws://0.0.0.0:9876` üzerinde dinler.

Farklı port kullanmak için:
```bash
BRIDGE_PORT=8443 pnpm dev:bridge
```

### 2. Mobil Uygulamayı Başlat

```bash
pnpm dev:mobile
```

Expo Dev Client açılır. iOS Simulator, Android Emulator veya fiziksel cihazda çalıştırın.

### 3. Bağlan

1. Mobil uygulamada **"QR ile Bağlan"** butonuna basın
2. Kamerayı terminal'deki QR koda tutun
3. Bağlantı kurulunca **"Sohbet"** ekranına geçin
4. Kod yazın!

## Proje Yapısı

```
copilot-mobile/
├── packages/
│   └── shared/              # Protokol tipleri, Zod şemaları, adapter arayüzleri
├── apps/
│   ├── bridge-server/       # WSS bridge server (Node.js + copilot-sdk)
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
|-------|----------|
| `pnpm dev:bridge` | Bridge server'ı başlat |
| `pnpm dev:mobile` | Mobil uygulamayı başlat |
| `pnpm build:shared` | Shared paketi derle |
| `pnpm build:bridge` | Bridge server'ı derle |
| `pnpm typecheck` | Tüm paketlerde tip kontrolü |
| `pnpm test` | Gerçek Copilot CLI ile E2E testlerini çalıştır |

## Güvenlik

- **WS (local network)**: Pairing ve JWT auth ile yerel ağda mobil istemci bağlantısı sağlanır
- **QR Pairing**: Tek kullanımlık token, 2 dakika TTL
- **JWT Auth**: HS256, 24 saat TTL, reconnect desteği
- **Rate Limiting**: Pairing (5/5dk), mesaj (30/dk) sliding window
- **Replay Protection**: 5 dakikalık pencerede aynı mesaj ID reddedilir
- **Tek İstemci**: Bridge server aynı anda yalnızca bir mobil cihaz kabul eder

## Teknoloji

- **Shared**: TypeScript, Zod
- **Bridge Server**: Node.js, ws, jsonwebtoken, @github/copilot-sdk
- **Mobile**: Expo 54, React Native 0.81.5, Expo Router 6, Zustand 5, expo-camera, expo-secure-store

## Test Notu

- `pnpm test` artık mock kullanmaz; gerçek Copilot CLI entegrasyonunu doğrular
- Bunun için GitHub hesabınızın CLI üzerinde açık olması gerekir
- Gerekirse önce `gh auth login` çalıştırın ve Copilot CLI erişiminin hazır olduğundan emin olun
