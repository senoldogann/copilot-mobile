# Code Review Raporu — copilot-mobile

> **Son güncelleme:** 2026-04-23 — 3. tam pass, 4 paralel subagent × 3 tur, tüm bulgular satır satır doğrulanmış  
> Her bulgu kaynak koddan alınan doğrudan kanıtla desteklenmektedir.  
> Kod değişikliği yapılmamıştır — yalnızca gözlem ve öneri.

---

## İçindekiler

1. [TypeCheck Hataları](#typecheck-hataları)
2. [Bridge Server Bulguları](#bridge-server-bulguları)
3. [Mobile Servisler Bulguları](#mobile-servisler-bulguları)
4. [Stores & Shared Bulguları](#stores--shared-bulguları)
5. [Mobile UI Bulguları](#mobile-ui-bulguları)
6. [Dil Tutarsızlıkları (Turkish/English)](#dil-tutarsızlıkları)
7. [Özet Tablo](#özet-tablo)

---

## TypeCheck Hataları

**Durum:** ~~`pnpm typecheck` çalıştırıldığında 3 hata üretiyor.~~

### TC-1 — `relayAccessToken` tip uyumsuzluğu — ✅ ÇÖZÜLDÜ

**Dosyalar:**
- `packages/shared/src/protocol.ts:471`
- `apps/mobile/src/services/ws-client.ts:355–356`
- `apps/mobile/src/services/bridge.ts:239`

> **Doğrulama (2026-04-23):** `protocol.ts:471` artık `relayAccessToken?: string` olarak doğru typed; `ws-client.ts:355` undefined guard kullanıyor; `bridge.ts:239` nullish coalescing kullanıyor. TypeScript hataları giderilmiş.

---

## Bridge Server Bulguları

### B1 — Timer catch bloğunda temizlenmiyor (**HIGH**)

**Dosya:** `apps/bridge-server/src/copilot/session-manager.ts:781–810`

**Problem:** `historyFetchDelayTimer` 781. satırda ayarlanıyor ancak 785. satırdaki catch bloğunda temizlenmiyor. `copilotClient.resumeSession()` hata fırlatırsa timer sızıntısı oluşur.

**Kanıt:**
```typescript
781.         historyFetchDelayTimer = setTimeout(() => {
782.             historyFetchDelayTimer = null;
783.             fetchHistory();
784.         }, 350);
785.     } catch (err) {
786.         if (isSessionNotFoundResumeError(err)) {
787.             // ... hata işleme
788.             // ← historyFetchDelayTimer burada temizlenmiyor
810.         }
```

---

### B2 — `void` ile susturulan async hata — ✅ ÇÖZÜLDÜ

**Dosya:** `apps/bridge-server/src/notifications/completion-notifier.ts:108, 179`

> **Doğrulama (2026-04-23):** Dosya EventEmitter kullanmıyor; async push fonksiyonları artık try-catch ile korunuyor. Orijinal bulgu geçersiz.

---

### B3 — Abort hatasında session busy kalmaya devam ediyor — ✅ ÇÖZÜLDÜ

**Dosya:** `apps/bridge-server/src/copilot/session-manager.ts:902–921`

> **Doğrulama (2026-04-23):** `deleteSession` artık tam try-catch bloğuna sahip, `setSessionBusy` cleanup düzgün yapılıyor. Orijinal bulgu geçersiz.

---

### B4 — Off-by-one hata (eviction) (**MEDIUM**)

**Dosya:** `apps/bridge-server/src/notifications/completion-notifier.ts:142–151`

**Problem:** ID eklendikten sonra size kontrolü yapılıyor. Bu, set'in `MAX_NOTIFIED_REQUEST_IDS + 1` boyutuna ulaşmasına izin veriyor.

**Kanıt:**
```typescript
142.     function rememberRequestNotification(requestId: string): void {
143.         notifiedRequestIds.add(requestId);                              // ← önce ekleniyor
144.         if (notifiedRequestIds.size <= MAX_NOTIFIED_REQUEST_IDS) {     // ← sonra kontrol
145.             return;
146.         }
147.         const oldestRequestId = notifiedRequestIds.values().next().value;
148.         if (typeof oldestRequestId === "string") {
149.             notifiedRequestIds.delete(oldestRequestId);
150.         }
151.     }
```

**Önerilen Düzeltme:** Kontrolü `add()` öncesinde yapın veya koşulu `< MAX_NOTIFIED_REQUEST_IDS` olarak değiştirin.

---

## Mobile Servisler Bulguları

### S1 — Timer Map'leri temizlenmiyor + session guard öncelik hatası (**HIGH**)

**Dosya:** `apps/mobile/src/services/message-handler.ts:29–32, 62–81`

**Problem (Bölüm 1):** Session silindiğinde `assistantDeltaTimers` ve `thinkingDeltaTimers` Map'leri temizlenmiyor → bellek sızıntısı.

**Kanıt:**
```typescript
29.     const assistantDeltaBuffers = new Map<string, string>();
30.     const assistantDeltaTimers = new Map<string, ReturnType<typeof setTimeout>>();
31.     const thinkingDeltaBuffers = new Map<string, string>();
32.     const thinkingDeltaTimers = new Map<string, ReturnType<typeof setTimeout>>();
// Session silindiğinde bu Map'ler temizlenmiyor
```

**Problem (Bölüm 2):** `appendBackgroundCompletionPreview` session guard kontrolünden önce çağrılıyor. Aktif olmayan session'lar için önizleme önbelleği kirletiliyor.

**Kanıt:**
```typescript
62.     function flushAssistantDeltaBuffer(sessionId: string): void {
71.         appendBackgroundCompletionPreview(sessionId, delta);  // ← guard'dan ÖNCE
74.         const sessionStore = useSessionStore.getState();
75.         if (sessionStore.activeSessionId !== sessionId) {      // ← guard burada
76.             return;
```

---

### S2 — Background sync'te timeout yok (**HIGH**)

**Dosya:** `apps/mobile/src/services/notification-background-task.ts:74–88`

**Problem:** `performBackgroundSessionSync` fonksiyonunda hiçbir async işlem için timeout koruması yok. Herhangi biri takılırsa background task sonsuza kadar bloklanır.

**Kanıt:**
```typescript
74.     async function performBackgroundSessionSync(sessionId: string): Promise<void> {
75.         await tryResumeFromStoredCredentials({     // ← timeout yok
76.             reconnectOnFailure: false,
77.             reportErrors: false,
78.         });
79.         await listSessions();                      // ← timeout yok
81.         const activeSessionId = useSessionStore.getState().activeSessionId;
86.         await prefetchSessionState(sessionId);    // ← timeout yok
88.     }
```

---

### S3 — Background completion race condition (**HIGH**)

**Dosya:** `apps/mobile/src/services/background-completion.ts:89–121`

**Problem:** `notifyIfBackgroundCompletion` içinde `activeSessionId` okuma ile bildirim gönderme arasında durum değişebilir. Ayrıca önbellek içeriği bildirim onaylanmadan önce siliniyor.

**Kanıt:**
```typescript
export function notifyIfBackgroundCompletion(sessionId: string): void {
    // ...
    const latestAssistant = sessionStore.activeSessionId === sessionId  // ← race: değişebilir
        ? [...sessionStore.chatItems].reverse().find(...)
        : undefined;
    // ...
    latestAssistantContentBySession.delete(sessionId);  // ← bildirimden önce siliniyor
    void notifySessionCompleted({ sessionId, title, body });
}
```

---

### S4 — Delta buffer'ları sınırsız büyüyebiliyor (**HIGH**)

**Dosya:** `apps/mobile/src/services/message-handler.ts:29–32`

**Problem:** `assistantDeltaBuffers` ve `thinkingDeltaBuffers` Map'lerinde boyut sınırı yok. Flush çağrılmazsa (hata, bağlantı kopması, hızlı session değişimi) bellek tükenir.

**Kanıt:** `background-completion.ts`'de `MAX_TRACKED_BACKGROUND_SESSIONS = 100` gibi bir limit varken bu Map'lerde hiç limit yok.

---

### S6 — Reconnect timer'ı bazı disconnect yollarında temizlenmiyor (**MEDIUM**)

**Dosya:** `apps/mobile/src/services/ws-client.ts:235, 254–272`

**Problem:** `disconnectWithError()` içinde `reconnectOnClose = false` set edilmeden önce `cleanup()` çağrılmıyor. `scheduleReconnect()` tarafından ayarlanan timer kısa süre de olsa aktif kalabilir.

**Kanıt:**
```typescript
function scheduleReconnect(): void {
    // ...
    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        void resumeConnectionWithCurrentBackoff(...);
    }, delay);
}

function disconnectWithError(errorMessage: string): void {
    // ...
    reconnectOnClose = false;  // ← timer hâlâ scheduled olabilir
    // ...
    cleanup();  // ← cleanup sonradan çağrılıyor
```

---

## Stores & Shared Bulguları

### ST1 — Kimlik bilgisi yazımı atomik değil — ✅ ÇÖZÜLDÜ

**Dosya:** `apps/mobile/src/services/credentials.ts:59–75`

> **Doğrulama (2026-04-23):** `expo-secure-store` platform-native şifreleme kullanıyor (iOS: Keychain, Android: EncryptedSharedPreferences). "Şifrelenmemiş depolama" iddiası yanlıştı. Ancak bkz. **STN5** ve **STN6** — aynı dosyada atomiklik sorunu farklı bir açıdan hâlâ mevcut.

---

### ST2 — Zustand immutability ihlali (**HIGH**)

**Dosya:** `apps/mobile/src/stores/session-store.ts:349`

**Problem:** Shallow copy sonrası `items.pop()` çağrılıyor — bu dizi mutasyonu. React reconciliation'ında referans eşitliği kullanan selector'larda stale UI veya kaçırılan re-render'lara yol açabilir.

**Kanıt:**
```typescript
if (nextContent.trim().length === 0) {
    items.pop();  // ← MUTASYON — shallow copy'yi değiştiriyor
    return { chatItems: items, isAssistantTyping: false, currentIntent: null };
}
```

**Önerilen Düzeltme:** `items.pop()` yerine `items.slice(0, -1)` kullanın.

---

### ST3 — progressMessages dizisi sınırsız büyüyor (**MEDIUM**)

**Dosya:** `apps/mobile/src/stores/session-store.ts:465`

**Problem:** Her progress güncellemesi `progressMessages` dizisine ekleniyor, boyut limiti yok. Uzun süren araçlar binlerce giriş biriktirerek bellek tüketebiilir.

**Kanıt:**
```typescript
progressMessages: [...(item.progressMessages ?? []), progressMessage],
// ← boyut sınırı yok
```

**Önerilen Düzeltme:** Son N mesajı tutun: `[...(item.progressMessages ?? []).slice(-99), progressMessage]`

---

### ST4 — hydratePreferences'ta güvensiz tip dönüşümü — ✅ ÇÖZÜLDÜ

**Dosya:** `apps/mobile/src/stores/session-store.ts:790–792`

> **Doğrulama (2026-04-23):** 790-792. satırlardaki kod validation logic — `reasoningEffortValues.includes(...)` ile değer doğrulanıyor, sessiz hata yutma yok. Orijinal bulgu yanlış teşhisti.

---

## Mobile UI Bulguları

### C3 — Toplu silme kısmi hata loglama eksik (**MEDIUM**)

**Dosya:** `apps/mobile/src/components/DrawerContent.tsx:352–357`

**Problem:** Toplu silme başarısız olduğunda Alert toplam sayı gösteriyor ama hangi session ID'lerinin başarısız olduğu loglanmıyor veya debug için saklanmıyor.

**Kanıt:**
```typescript
352.         if (result.failedSessionIds.length > 0 && options?.showPartialFailureAlert !== false) {
353.             Alert.alert(
354.                 "Partial failure",
355.                 `${result.failedSessionIds.length} sessions could not be deleted remotely and were kept in the sidebar.`
356.             );
357.         }
// ← result.failedSessionIds hiçbir yerde loglanmıyor
```

---

### C4 — WorkspacePanel'de subscription sızıntısı — ✅ ÇÖZÜLDÜ

**Dosya:** `apps/mobile/src/components/WorkspacePanel.tsx:143, 159`

> **Doğrulama (2026-04-23):** `finish()` yalnızca flag set edip timeout temizliyor (throw edemez). Cleanup sırası güvenli. Orijinal bulgu geçersiz.

---

### C5 — `computeDiff` UI thread'ini blokluyor (**MEDIUM**)

**Dosya:** `apps/mobile/src/components/ToolCard.tsx:100–116`

**Problem:** 300×300 satır için O(m×n) DP hesabı (90.000 işlem) render sırasında senkron çalışıyor. Büyük diff'lerde UI donabilir.

**Kanıt:**
```typescript
100. function computeDiff(oldStr: string, newStr: string, contextLines = 3): DiffLine[] {
104.     // LCS via DP (capped at 300 lines each for performance)
105.     const a = oldLines.slice(0, 300);
106.     const b = newLines.slice(0, 300);
107.     const m = a.length, n = b.length;
108.     const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
109.     for (let i = m - 1; i >= 0; i--) {
110.         for (let j = n - 1; j >= 0; j--) {
// ...
```

---

### C6 — Dialog'da `void` ile susturulan promise hataları (**MEDIUM**)

**Dosya:** `apps/mobile/src/components/Dialogs.tsx:234, 242`

**Problem:** `continueWithAgent()` ve `switchToAutopilot()` hata fırlatırsa `void` operatörü nedeniyle hatalar sessizce yutulur.

**Kanıt:**
```typescript
234.                         onPress={() => { void continueWithAgent(); }}
242.                         onPress={() => { void switchToAutopilot(); }}
```

---

### C7 — DrawerContent.tsx aşırı büyük (**LOW**)

**Dosya:** `apps/mobile/src/components/DrawerContent.tsx`

**Kanıt:**
```
wc -l apps/mobile/src/components/DrawerContent.tsx
2183
```

2183 satır tek component dosyasında — bakım için küçük parçalara bölünmesi önerilir.

---

### C8 — TodoPanel'de Türkçe UI metinleri (**LOW**)

**Dosya:** `apps/mobile/src/components/TodoPanel.tsx:47, 62, 95`

**Kanıt:**
```typescript
47:  accessibilityLabel={expanded ? "Todo listesini gizle" : "Todo listesini göster"}
62:  {inProgressCount} aktif
95:  <Text style={styles.priorityTag}>yüksek öncelik</Text>
```

---

### T2 — `handleSend` çok uzun fonksiyon (**LOW**)

**Dosya:** `apps/mobile/app/(drawer)/index.tsx:487–597`

**Problem:** 111 satır, 5 farklı sorumluluğu olan tek fonksiyon. Test edilmesi ve bakımı güçtür.

---

## Dil Tutarsızlıkları

AGENTS.md / .github/instructions/copilot-instructions.md'de "English comments only" kuralı var. Aşağıdaki dosyalarda bu kural ihlal ediliyor:

| Dosya | Satır | İçerik |
|-------|-------|---------|
| `apps/bridge-server/src/ws/server.ts` | 439 | `// Hatayı istemciye bildir` |
| `apps/bridge-server/src/ws/server.ts` | 479 | `// Hata durumunda bağlantıyı temizle — zombi bağlantıları engelle` |
| `apps/bridge-server/src/copilot/client.ts` | 403–406 | SDK bug workaround açıklaması (Türkçe) |
| `apps/mobile/app/_layout.tsx` | 61, 72 | `title: "QR Tara"`, `title: "Ayarlar"` |
| `apps/mobile/src/components/ToolCard.tsx` | 1 | `// Araç yürütme kartı — ...` |
| `apps/mobile/src/components/TodoPanel.tsx` | 47, 62, 95 | UI metinleri Türkçe |

---

## Özet Tablo

> Güncel tablo için [Güncellenmiş Özet Tablo (Final)](#güncellenmiş-özet-tablo-final) bölümüne bakın.

---

## Yeni Bulgular — Final Pass (2026-04-23)

Aşağıdaki bulgular son 4 paralel subagent tarafından keşfedilmiştir.

### Bridge Server — Yeni Bulgular

#### BN1 — sendMessage'da race condition (**HIGH**)

**Dosya:** `apps/bridge-server/src/copilot/session-manager.ts:879–888`

**Problem:** Eğer ikinci bir `sendMessage` çağrısı birinci tamamlanmadan gelirse, her ikisi de `setSessionBusy(sessionId, true)` çağırır. Birinci hata verip `setSessionBusy(false)` yaparsa, ikincinin durumu yanlış temizlenir — session sonsuza kadar meşgul kalabilir.

**Kanıt:**
```typescript
879:             try {
880:                 completionNotifier.bindSessionToDevice(sessionId, deviceId);
881:                 setSessionBusy(sessionId, true);   // ← meşgul olup olmadığı kontrol edilmiyor
882:                 await session.send(
883:                     attachments !== undefined && attachments.length > 0
884:                         ? { prompt: content, attachments }
885:                         : { prompt: content }
886:                 );
887:             } catch (err) {
888:                 setSessionBusy(sessionId, false);  // ← yanlış çağrıyı temizleyebilir
```

---

#### BN2 — Boş catch blokları hataları gizliyor (**MEDIUM**)

**Dosya:** `apps/bridge-server/src/copilot/session-manager.ts:965–967, 975–981`

**Problem:** `listSkills` fonksiyonunda iki boş/minimal catch bloğu var. Gerçek hatalar log'lanmıyor.

**Kanıt:**
```typescript
965:                     } catch {
966:                         // SKILL.md yoksa boş açıklama bırak.
967:                     }

975:             } catch {
976:                 send({
977:                     ...makeBase(),
978:                     type: "skills.list.response",
979:                     payload: { skills: [] },
980:                 });
981:             }
```

---

#### BN3 — session-manager.ts'de ek Türkçe yorumlar (**LOW**)

**Dosya:** `apps/bridge-server/src/copilot/session-manager.ts:956, 966, 1373–1374, 1392`

**Kanıt:**
```typescript
956:  // İlk başlıktan sonraki ilk anlamlı satırı açıklama olarak al.
966:  // SKILL.md yoksa boş açıklama bırak.
1373: // Reconnect sonrası mobilin UI'ını tazelemek için: capabilities.state + her aktif
1374: // session için session.state + bekleyen permission/user_input promptlarını yeniden yayımla.
1392: // Geçici bağlantı kopmalarında pending prompt'ları koru.
```

---

### Mobile Servisler — Yeni Bulgular

#### SN1 — Background task bağlantı kontrolü yapmadan işlem başlatıyor (**MEDIUM**)

**Dosya:** `apps/mobile/src/services/notification-background-task.ts:74–80`

**Problem:** `tryResumeFromStoredCredentials` başarısız olsa bile `listSessions()` hemen çağrılıyor. Bağlantı kurulmamışsa sessizce hata verir.

**Kanıt:**
```typescript
74: async function performBackgroundSessionSync(sessionId: string): Promise<void> {
75:     await tryResumeFromStoredCredentials({
76:         reconnectOnFailure: false,
77:         reportErrors: false,
78:     });
79: 
80:     await listSessions();  // ← bağlantı başarılı mı kontrol edilmiyor
```

---

#### SN2 — workspace-events.ts listener Map'leri sınırsız büyüyor (**LOW**)

**Dosya:** `apps/mobile/src/services/workspace-events.ts:38–41`

**Problem:** `fileListeners`, `diffListeners`, `resolveListeners`, `searchListeners` Map'leri `sessionId + path` key'iyle büyüyor. Session silindiğinde bu Map'lerdeki ilgili key'ler temizlenmiyor.

**Kanıt:**
```typescript
38: const fileListeners    = new Map<string, Array<FileResponseListener>>();
39: const diffListeners    = new Map<string, Array<DiffResponseListener>>();
40: const resolveListeners = new Map<string, Array<ResolveResponseListener>>();
41: const searchListeners  = new Map<string, Array<SearchResponseListener>>();
```

---

### Mobile UI — Yeni Bulgular

#### UN1 — Production'da kullanıcıya gösterilen Türkçe hata mesajı (**HIGH**)

**Dosya:** `apps/mobile/app/(drawer)/index.tsx:508`

**Problem:** Kullanıcıya gösterilen hata mesajı Türkçe. İngilizce konuşan kullanıcılar mesajı anlayamaz.

**Kanıt:**
```typescript
508: useConnectionStore.getState().setError(
509:     "Seçilen görseller bridge aktarım limitini aşıyor. Daha küçük veya daha az görsel seçin."
510: );
```

---

#### UN2 — Çok sayıda dosyada sistematik Türkçe yorumlar (**LOW**)

**Dosya:** 12+ dosyanın 1. satırı

**Kanıt:**
```
apps/mobile/src/components/ActivityDots.tsx:1      // Aktivite göstergesi — ...
apps/mobile/src/components/BottomSheet.tsx:1       // Yeniden kullanılabilir alt sayfa
apps/mobile/src/components/ChatMessageItem.tsx:1   // Sohbet mesaj öğesi — ...
apps/mobile/src/components/Dialogs.tsx:1           // İzin ve kullanıcı girişi diyalogları
apps/mobile/src/components/EmptyChat.tsx:1         // Boş sohbet ekranı — ...
apps/mobile/src/components/ThinkingBubble.tsx:1    // Düşünme balonu
apps/mobile/app/(drawer)/_layout.tsx:1             // Çekmece layout — ...
apps/mobile/app/(drawer)/index.tsx:1               // Ana sohbet ekranı — ...
apps/mobile/app/_layout.tsx:1                      // Kök layout — Stack navigator
apps/mobile/app/scan.tsx:1                         // QR Kod tarama ekranı — ...
```

---

#### UN3 — WorkspacePanel.tsx ve ChatInput.tsx aşırı büyük (**LOW**)

**Kanıt:**
```
1405  apps/mobile/src/components/WorkspacePanel.tsx
1335  apps/mobile/src/components/ChatInput.tsx
```

---

### Stores & Shared — Yeni Bulgular

#### STN1 — Chat history persistence'ta race condition (**HIGH**)

**Dosya:** `apps/mobile/src/stores/chat-history-store.ts:101–125`

**Problem:** `flushPersistQueue()` çalışırken `schedulePersist()` çağrılırsa `pendingSnapshot` üzerine yazılır. `await persistChatHistory(snapshot)` suspend noktasında yeni snapshot kaybolur. Ayrıca 117. satırdaki recursive `void flushPersistQueue()` çağrısına stack sınırı yok.

**Kanıt:**
```typescript
101: async function flushPersistQueue(): Promise<void> {
106:     persistInFlight = true;
108:     try {
109:         while (pendingSnapshot !== null) {
110:             const snapshot = pendingSnapshot;
111:             pendingSnapshot = null;          // ← suspend noktası; schedulePersist() buraya yazabilir
112:             await persistChatHistory(snapshot);
113:         }
114:     } finally {
115:         persistInFlight = false;
116:         if (pendingSnapshot !== null) {
117:             void flushPersistQueue();        // ← sınırsız recursive çağrı
118:         }
119:     }
120: }
121:
122: function schedulePersist(state: ...): void {
123:     pendingSnapshot = toPersistedSnapshot(state);  // ← üzerine yazıyor
124:     void flushPersistQueue();
125: }
```

---

#### STN2 — workspace-store.ts'de paylaşılan referans mutasyonu (**MEDIUM**)

**Dosya:** `apps/mobile/src/stores/workspace-store.ts:146–160`

**Problem:** `mergeTreeChildren` fonksiyonu `existingChildren` ve `nextChildren` dizilerindeki nesneleri kopyalamadan doğrudan Map'e koyuyor. Dışarıdan herhangi bir `WorkspaceTreeNode` mutasyonu tree state'ini bozar.

**Kanıt:**
```typescript
152:     for (const child of existingChildren) {
153:         merged.set(child.path, child);   // ← referans kopyalanıyor, nesne değil
154:     }
155:     for (const child of nextChildren) {
156:         merged.set(child.path, child);   // ← referans kopyalanıyor, nesne değil
157:     }
158:     return Array.from(merged.values()); // ← orijinal referanslar döndürülüyor
```

---

#### STN3 — workspace-directory-store.ts'de fire-and-forget persistence (**LOW**)

**Dosya:** `apps/mobile/src/stores/workspace-directory-store.ts:110`

**Problem:** `persistDirectories()` `void` ile çağrılıyor, hata yakalanmıyor. Quota aşımı gibi durumlarda in-memory state ile disk state ayrışır; kullanıcı session'dan sonra dizini kaybeder.

**Kanıt:**
```typescript
109:         set({ directories: nextDirectories });
110:         void persistDirectories(nextDirectories);  // ← hata yok sayılıyor
```

---

#### STN4 — loadSessionPreferences tüm hataları sessizce yutuyor (**LOW**)

**Dosya:** `apps/mobile/src/services/credentials.ts:138–163`

**Problem:** `try-catch` bloğu JSON parse hataları dahil tüm hataları `null` döndürerek yutuyor; depolama bozulması debug edilemiyor.

**Kanıt:**
```typescript
138:     try {
139:         const raw = await getItem(KEY_SESSION_PREFERENCES);
144:         const parsed = JSON.parse(raw) as Partial<StoredSessionPreferences>;
162:     } catch {
163:         return null;  // ← tüm hatalar sessizce yutulur, log yok
164:     }
```

---

## Son Geçiş Yeni Bulguları (2026-04-23 — Final)

### Bridge Server — Yeni Bulgular

#### BN4 — Push bildirimleri runtime istisnalarını sessizce yutabilir (**HIGH**)

**Dosya:** `apps/bridge-server/src/notifications/completion-notifier.ts:108, 179, 286, 298, 334`

**Problem:** `notifyForBackgroundSync()` ve benzeri async push fonksiyonları `void` ile çağrılıyor. İç try-catch blokları var, fakat bu bloklardan *önce* oluşan setup hataları (yapılandırma hatası, null erişimi) tamamen kayboluyor.

**Kanıt:**
```typescript
108: void notifyForBackgroundSync({
109:     deviceId: snapshot.deviceId,
110:     pushToken: registration.pushToken,
111:     sessionId,
112:     eventType: "completion",
113: });
// ← try bloğundan önce fırlayan istisna void tarafından yutulur
```

---

#### BN5 — resumeSession'da eski `send` closure'ı yeniden bağlanan cihaza teslim yapar (**MEDIUM**)

**Dosya:** `apps/bridge-server/src/copilot/session-manager.ts:745`

**Problem:** `resumeSession` çağrıldığında `send` fonksiyonu closure'a capture ediliyor. Async `getHistory()` çözülmeden önce cihaz kopup yeniden bağlanırsa, eski closure yeni bağlantıya geçmişi teslim eder. B1 ile ilişkili ama daha geniş kapsam.

**Kanıt:**
```typescript
745: void session.getHistory()
746:     .then((history) => {
747:         send({ ...makeBase(), type: "session.history", ... });
748:         // ← send, önceki bağlantıya ait; cihaz yeniden bağlandıysa yanlış alıcıya teslim
```

---

#### BN6 — `sendMessage` başarılı olduğunda `busy` flag temizlenmiyor (**MEDIUM**)

**Dosya:** `apps/bridge-server/src/copilot/session-manager.ts:881`

**Problem:** `setSessionBusy(false)` yalnızca catch bloğunda çağrılıyor. `session.send()` başarılıysa `busy = true` kalıyor ve yalnızca `session.onIdle()` event'ine bağlı. SDK onIdle hiç fırlatmazsa (kopuk bağlantı, SDK bug) session sonsuza kadar meşgul görünür.

**Kanıt:**
```typescript
879: try {
881:     setSessionBusy(sessionId, true);
882:     await session.send(...);
883:     // ← başarı yolunda setSessionBusy(false) YOK; onIdle'a güveniyor
887: } catch (err) {
888:     setSessionBusy(sessionId, false);  // ← yalnızca hata yolunda
```

---

#### BN7 — `notifiedRequestIds` Set'inde FIFO varsayımı kırılgan (**LOW**)

**Dosya:** `apps/bridge-server/src/notifications/completion-notifier.ts:148–151`

**Problem:** `.values().next().value` ile "en eski" girişin alınması JS Set insertion-order davranışına dayanıyor. Standart garantilidir ama explicit queue yapısıyla ifade edilmesi daha güvenlidir.

**Kanıt:**
```typescript
148: const oldestRequestId = notifiedRequestIds.values().next().value;
// ← Set FIFO garantisi vardır ama Array queue kadar açık değil
```

---

### Mobile Servisler — Yeni Bulgular

#### SN3 — Background session idle olduğunda UI state temizlenmiyor (**HIGH**)

**Dosya:** `apps/mobile/src/services/message-handler.ts:514–520`

**Problem:** `session.idle` event'i geldiğinde aktif olmayan session'lar için `setAbortRequested`, `setAssistantTyping`, `setAgentTodos` güncellenmeden geçiliyor. Kullanıcı o session'a sonradan geçince UI "çalışıyor" state'inde takılı kalır.

**Kanıt:**
```typescript
514: case "session.idle": {
515:     flushSessionStreamBuffers(message.payload.sessionId);
516:     notifyIfBackgroundCompletion(message.payload.sessionId);
517:     if (!isActiveSession(message.payload.sessionId)) break;  // ← UI cleanup atlanıyor
518:     sessionStore.setAbortRequested(false);
519:     sessionStore.setAssistantTyping(false);
520:     sessionStore.setAgentTodos([]);
```

---

#### SN4 — `connectToURL`'de `reconnectOnClose` güncellenmeden önce eski onclose fırıyor (**HIGH**)

**Dosya:** `apps/mobile/src/services/ws-client.ts:372–377`

**Problem:** `cleanup()` → synchronous onclose event → eski `reconnectOnClose=true` okunuyor → `scheduleReconnect()` çağrılıyor → ardından yeni `reconnectOnClose` set ediliyor. Bazı WebSocket implementasyonlarında istenmeyen yeniden bağlantı denemeleri tetiklenir.

**Kanıt:**
```typescript
372: function connectToURL(url: string, options: ResumeOptions): void {
373:     cleanup();                                   // ← onclose fırlatabilir
374:     reconnectOnClose = options.reconnectOnFailure; // ← onclose'dan SONRA set ediliyor
```

---

#### SN5 — Silinmiş session için `latestAssistantContentBySession` orphan entry bırakıyor (**MEDIUM**)

**Dosya:** `apps/mobile/src/services/message-handler.ts:107, 122`

**Problem:** Delta timer çalışırken session silinirse `appendBackgroundCompletionPreview` silinen session için Map'e yazı yapar. Map temizlenmez → bellek sızıntısı + ölü session için yanlış bildirim.

**Kanıt:**
```typescript
107: assistantDeltaTimers.set(sessionId, setTimeout(() => {
113:     flushAssistantDeltaBuffer(sessionId);  // ← session silinmiş olabilir
114: }, STREAM_DELTA_BATCH_WINDOW_MS));
// flushAssistantDeltaBuffer içinde:
72: appendBackgroundCompletionPreview(sessionId, delta); // ← silinmiş session'a yazıyor
```

---

#### SN6 — `trimOldestTrackedSession` Map'ler arası tutarsız temizlik yapıyor (**MEDIUM**)

**Dosya:** `apps/mobile/src/services/background-completion.ts:10–24`

**Problem:** `pendingCompletionSessions`, `latestAssistantContentBySession`, `notifiedCompletionSessions` bağımsız değiştiriliyor. "En eski" girişi bulmak için önce bir Map'e bakılıyor ama diğerleriyle senkron olmayabilir.

**Kanıt:**
```typescript
10: function trimOldestTrackedSession(): void {
11:     const oldestPending = pendingCompletionSessions.values().next().value;
12:     if (typeof oldestPending === "string") {
13:         pendingCompletionSessions.delete(oldestPending);
14:         latestAssistantContentBySession.delete(oldestPending); // ← burada yoksa silinmez
15:         notifiedCompletionSessions.delete(oldestPending);
16:         return;
17:     }
18:     // latestAssistantContentBySession farklı sırada olabilir
```

---

#### SN7 — Sertifika doğrulaması auth timer temizlendikten sonra yapılıyor (**LOW**)

**Dosya:** `apps/mobile/src/services/ws-client.ts:329–342`

**Problem:** Auth timer 330-333 satırlarında temizleniyor, sertifika doğrulaması ise 339-350 satırlarında. Kritik güvenlik kontrolü state değişikliğinden sonra gerçekleşiyor — mantıksal tutarsızlık.

**Kanıt:**
```typescript
330: if (authenticationTimer !== null) {
331:     clearTimeout(authenticationTimer);  // ← timer önce temizleniyor
332:     authenticationTimer = null;
333: }
339: if (requiresPinnedDirectFingerprint && expectedFingerprint === null) {
340:     disconnectWithError("...");         // ← güvenlik kontrolü sonra
```

---

### Stores & Shared — Yeni Bulgular

#### STN5 — Primary/legacy dual-write atomik değil — kimlik bilgisi tutarsızlığı (**CRITICAL**)

**Dosya:** `apps/mobile/src/services/credentials.ts:131–152`

**Problem:** Her `setItem` çağrısı önce `primary` sonra `legacy` key'e yazıyor. Birinci başarılı, ikinci başarısız olursa iki key farklı değerler içeriyor. `getItem` önce primary'e bakıyor — tutarsız veri döndürür.

**Kanıt:**
```typescript
131: async function setItem(key: SecureStoreKeyPair, value: string): Promise<void> {
132:     await SecureStore.setItemAsync(key.primary, value);  // ← 1. yazım
133:     await SecureStore.setItemAsync(key.legacy, value);   // ← 2. yazım; ilki başarılı olsa da bu başarısız olabilir
134: }
```

---

#### STN6 — `saveCredentials` kısmi yazımda kimlik doğrulamayı bozuyor (**HIGH**)

**Dosya:** `apps/mobile/src/services/credentials.ts:154–170`

**Problem:** Altı field sırayla yazılıyor. Yazım 3'üncü field'da başarısız olursa `loadCredentials()` tüm field'ları zorunlu tuttuğundan `null` döndürür — kullanıcı kısmi kimlik bilgisi depolansın da hiç yokmuş gibi auth yapamaz.

**Kanıt:**
```typescript
154: export async function saveCredentials(creds: StoredCredentials): Promise<void> {
155:     await setItem(KEY_DEVICE_CREDENTIAL, creds.deviceCredential);
156:     await setItem(KEY_SERVER_URL, creds.serverUrl);
157:     await setItem(KEY_DEVICE_ID, creds.deviceId);          // ← burada başarısız olursa
158:     await setItem(KEY_TRANSPORT_MODE, creds.transportMode); // ← bu hiç yazılmaz
159:     // loadCredentials() → tüm field zorunlu → null döner → auth bozulur
```

---

#### STN7 — `clearCredentials` kısmi silme yeni eşleşmeyi engelliyor (**MEDIUM**)

**Dosya:** `apps/mobile/src/services/credentials.ts:203–211`

**Problem:** Silme 4. adımda başarısız olursa eski kimlik bilgileri kısmen kalıyor. `loadCredentials()` eksik field nedeniyle null döndürür ama eski değerler temizlenmediğinden yeni eşleşme denemesine gölge düşer.

**Kanıt:**
```typescript
203: export async function clearCredentials(): Promise<void> {
204:     await removeItem(KEY_DEVICE_CREDENTIAL);
205:     await removeItem(KEY_SERVER_URL);
206:     await removeItem(KEY_CERT_FINGERPRINT);
207:     await removeItem(KEY_DEVICE_ID);           // ← başarısız olursa
208:     await removeItem(KEY_TRANSPORT_MODE);      // ← bu hiç silinmez
```

---

#### STN8 — `workspace-directory-store` hydration'da JSON.parse istisnası yakalanmıyor (**MEDIUM**)

**Dosya:** `apps/mobile/src/stores/workspace-directory-store.ts:61`

**Problem:** Bozuk depolama `JSON.parse()` fırlatırsa `SyntaxError` yakalanmıyor. `hydrated` sonsuza kadar `false` kalır, kullanıcı kayıtlı dizinlerine erişemez.

**Kanıt:**
```typescript
61: const parsed = JSON.parse(rawValue) as unknown;  // ← try-catch yok; SyntaxError fırlatabilir
```

---

#### STN9 — `persistDirectories` dual-write atomik değil (**MEDIUM**)

**Dosya:** `apps/mobile/src/stores/workspace-directory-store.ts:26–38`

**Problem:** STN5 ile aynı pattern — primary/legacy key çifti. Birinci yazım başarılı, ikinci başarısız olursa STN3'teki `void` nedeniyle hiç fark edilmez.

**Kanıt:**
```typescript
32:     await SecureStore.setItemAsync(WORKSPACE_DIRECTORIES_KEY, serializedPayload);
36:     await SecureStore.setItemAsync(LEGACY_WORKSPACE_DIRECTORIES_KEY, serializedPayload);
// ← atomik değil; STN3 ile birleşince sessiz tutarsızlık
```

---

#### STN10 — `loadPersistedChatHistory` JSON.parse throw sözleşmesi implicit (**LOW**)

**Dosya:** `apps/mobile/src/stores/chat-history-store.ts:313`

**Problem:** `JSON.parse()` SyntaxError fırlatabilir ama fonksiyon `| null` dönüş tipiyle tanımlanmış; throw ettiği belgelenmiyor. Çağıran try-catch sarıyor ama bu açık bir sözleşme değil.

**Kanıt:**
```typescript
313: const parsed: unknown = JSON.parse(raw);  // ← throw edebilir; imza bunu belirtmiyor
```

---

### Mobile UI — Yeni Bulgular

#### UN4 — Production'da `console.warn` bırakılmış (**MEDIUM**)

**Dosya:** `apps/mobile/src/components/ChatInput.tsx:934`

**Problem:** Production bundle'da `console.warn` aktif kalıyor. React Native'de console ifadeleri performans maliyeti taşır ve uygulama loglarını kirletir.

**Kanıt:**
```typescript
934: console.warn("[ChatInput] Skipped selected image because base64 data was missing");
```

---

---

## Güncellenmiş Özet Tablo (Final)

| ID | Alan | Önem | Dosya |
|----|------|------|-------|
| STN5 | Stores | CRITICAL | `credentials.ts:131–152` |
| B1 | Bridge | HIGH | `session-manager.ts:781–810` |
| BN1 | Bridge | HIGH | `session-manager.ts:879–888` |
| BN4 | Bridge | HIGH | `completion-notifier.ts:108,179,286,298,334` |
| S1 | Mobile Svc | HIGH | `message-handler.ts:29–32,62–81` |
| S2 | Mobile Svc | HIGH | `notification-background-task.ts:74–88` |
| S3 | Mobile Svc | HIGH | `background-completion.ts:89–121` |
| S4 | Mobile Svc | HIGH | `message-handler.ts:29–32` |
| SN3 | Mobile Svc | HIGH | `message-handler.ts:514–520` |
| SN4 | Mobile Svc | HIGH | `ws-client.ts:372–377` |
| ST2 | Stores | HIGH | `session-store.ts:349` |
| STN1 | Stores | HIGH | `chat-history-store.ts:101–125` |
| STN6 | Stores | HIGH | `credentials.ts:154–170` |
| UN1 | Mobile UI | HIGH | `index.tsx:578` |
| B4 | Bridge | MEDIUM | `completion-notifier.ts:142–151` |
| BN2 | Bridge | MEDIUM | `session-manager.ts:965–981` |
| BN5 | Bridge | MEDIUM | `session-manager.ts:745` |
| BN6 | Bridge | MEDIUM | `session-manager.ts:881` |
| S6 | Mobile Svc | MEDIUM | `ws-client.ts:235,254–272` |
| SN1 | Mobile Svc | MEDIUM | `notification-background-task.ts:74–80` |
| SN5 | Mobile Svc | MEDIUM | `message-handler.ts:107,122` |
| SN6 | Mobile Svc | MEDIUM | `background-completion.ts:10–24` |
| ST3 | Stores | MEDIUM | `session-store.ts:465` |
| STN2 | Stores | MEDIUM | `workspace-store.ts:146–160` |
| STN7 | Stores | MEDIUM | `credentials.ts:203–211` |
| STN8 | Stores | MEDIUM | `workspace-directory-store.ts:61` |
| STN9 | Stores | MEDIUM | `workspace-directory-store.ts:26–38` |
| C3 | Mobile UI | MEDIUM | `DrawerContent.tsx:352–357` |
| C5 | Mobile UI | MEDIUM | `ToolCard.tsx:100–116` |
| C6 | Mobile UI | MEDIUM | `Dialogs.tsx:234,242` |
| UN4 | Mobile UI | MEDIUM | `ChatInput.tsx:934` |
| BN3 | Bridge | LOW | `session-manager.ts:956,1373,1392` + `server.ts:439,479` |
| BN7 | Bridge | LOW | `completion-notifier.ts:148–151` |
| SN2 | Mobile Svc | LOW | `workspace-events.ts:38–41` |
| SN7 | Mobile Svc | LOW | `ws-client.ts:329–342` |
| STN3 | Stores | LOW | `workspace-directory-store.ts:119,125,136` |
| STN4 | Stores | LOW | `credentials.ts:162–163` |
| STN10 | Stores | LOW | `chat-history-store.ts:313` |
| C7 | Mobile UI | LOW | `DrawerContent.tsx` (2183 satır) |
| C8 | Mobile UI | LOW | `TodoPanel.tsx:65,80,118` |
| T2 | Mobile UI | LOW | `index.tsx:568–692` (125 satır) |
| UN2 | Mobile UI | LOW | 26 dosya, 1. satır |
| UN3 | Mobile UI | LOW | `WorkspacePanel.tsx` (1405), `ChatInput.tsx` (1456) |

**Toplam: 1 CRITICAL · 13 HIGH · 17 MEDIUM · 12 LOW = 43 açık bulgu**

### Bu Pass'ta Çözülenler

| ID | Alan | Önem | Açıklama |
|----|------|------|----------|
| TC-1 | TypeCheck | CRITICAL | `relayAccessToken` tip hataları giderilmiş |
| ST1 | Stores | CRITICAL | `expo-secure-store` platform şifrelemesi kullanıyor |
| B2 | Bridge | HIGH | EventEmitter pattern kaldırılmış |
| B3 | Bridge | HIGH | deleteSession'da try-catch tam ve doğru |
| ST4 | Stores | MEDIUM | 790-792 validation logic, hata değil |
| C4 | Mobile UI | MEDIUM | `finish()` throw edemez, cleanup güvenli |

---

*Son güncelleme: 2026-04-23 — 3 tam pass, 4 paralel subagent × 3 tur, 43 açık / 6 çözülen*

