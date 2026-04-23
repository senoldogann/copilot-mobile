# Chat Composer Improvements

Bu plan, sohbet deneyimindeki üç kullanıcı yüzeyi iyileştirmesini kapsar:

1. Kod bloklarına `Copy` ve `Apply` aksiyonları eklemek
2. Chat input içine sesle dikte eklemek
3. Composer içinde `#files`, `@participants` ve `/commands` autocomplete akışını iyileştirmek

## Kapsam

### [MODIFY] [apps/mobile/src/components/ChatMessageItem.tsx](/Users/dogan/Desktop/copilot-mobile/apps/mobile/src/components/ChatMessageItem.tsx)
- Kod bloklarına üst action bar eklenecek
- `Copy` cihaz panosuna kopyalayacak
- `Apply` kod bloğunu composer’a agent tarafından uygulanabilecek hazır bir prompt olarak ekleyecek
- `Apply` başarı durumu ancak composer gerçekten insert olayını kabul ederse gösterilecek

### [MODIFY] [apps/mobile/src/components/ChatInput.tsx](/Users/dogan/Desktop/copilot-mobile/apps/mobile/src/components/ChatInput.tsx)
- Mikrofon butonu eklenecek
- Ses tanıma sonucu mevcut seçim alanına yazılacak
- Hızlı tekrar tıklamalarda birden fazla voice session başlatılmaması için start akışı kilitlenecek
- `#` için dosya/context önerileri, `@` için participant önerileri, `/` için komut önerileri gösterilecek

### [MODIFY] [apps/mobile/src/components/chat-input-types.ts](/Users/dogan/Desktop/copilot-mobile/apps/mobile/src/components/chat-input-types.ts)
- Yeni autocomplete token türleri tanımlanacak

### [MODIFY] [apps/mobile/src/components/chat-input-styles.ts](/Users/dogan/Desktop/copilot-mobile/apps/mobile/src/components/chat-input-styles.ts)
- Yeni autocomplete satır düzeni ve voice button durum stilleri eklenecek

### [MODIFY] [apps/mobile/src/components/ProviderIcon.tsx](/Users/dogan/Desktop/copilot-mobile/apps/mobile/src/components/ProviderIcon.tsx)
- Copy, microphone, hash ve at ikonları eklenecek

### [ADD] [apps/mobile/src/services/composer-events.ts](/Users/dogan/Desktop/copilot-mobile/apps/mobile/src/services/composer-events.ts)
- Kod blokları ile composer arasında hafif bir insert event hattı kurulacak
- Event fonksiyonu insert işleminin gerçekten handle edilip edilmediğini boolean olarak döndürecek

### [MODIFY] [apps/mobile/src/components/WorkspacePanel.tsx](/Users/dogan/Desktop/copilot-mobile/apps/mobile/src/components/WorkspacePanel.tsx)
- `See files` akışı ayrı ve sorunlu ikinci modal yerine mevcut workspace sheet içinde açılacak

### [MODIFY] [apps/mobile/app.json](/Users/dogan/Desktop/copilot-mobile/apps/mobile/app.json)
- Speech recognition izin metinleri eklenecek

### [MODIFY] [apps/mobile/package.json](/Users/dogan/Desktop/copilot-mobile/apps/mobile/package.json)
- `expo-clipboard`
- `expo-speech-recognition`

## Notlar

- Bu plan `SN3` veya `SN4` production maddelerini kapsamaz.
- `Apply` bu aşamada doğrudan dosya yazmaz; composer’a uygulama prompt’u ekler.
- Sesli giriş için yeni native bağımlılık olduğu için fresh native build gerekir.
