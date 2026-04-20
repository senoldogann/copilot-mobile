// Sesli dikte servisi — expo-speech-recognition ile çalışır, yoksa hata döndürür.
// Modül dev build'e eklenmediyse runtime require hata verir ve UI bunu yakalar.

type VoiceModule = {
    ExpoSpeechRecognitionModule: {
        requestPermissionsAsync: () => Promise<{ granted: boolean }>;
        start: (options: { lang?: string; interimResults?: boolean; continuous?: boolean }) => void;
        stop: () => void;
        abort: () => void;
    };
    addSpeechRecognitionListener: (
        event: "result" | "error" | "end",
        cb: (payload: unknown) => void
    ) => { remove: () => void };
};

function loadVoiceModule(): VoiceModule {
    // Runtime require: modül dev build'e eklenmemişse fırlatır.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require("expo-speech-recognition") as unknown as VoiceModule;
    if (mod === undefined || mod.ExpoSpeechRecognitionModule === undefined) {
        throw new Error("expo-speech-recognition not available");
    }
    return mod;
}

export type DictationHandle = {
    stop: () => void;
};

export async function startVoiceDictation(
    onFinalText: (text: string) => void,
    onError: (message: string) => void
): Promise<DictationHandle> {
    const mod = loadVoiceModule();
    const perm = await mod.ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!perm.granted) {
        throw new Error("Microphone permission denied");
    }

    const resultSub = mod.addSpeechRecognitionListener("result", (payload) => {
        const typed = payload as {
            results?: ReadonlyArray<{ transcript?: string }>;
            isFinal?: boolean;
        };
        if (typed.isFinal === true && typed.results !== undefined && typed.results.length > 0) {
            const transcript = typed.results[0]?.transcript;
            if (typeof transcript === "string" && transcript.length > 0) {
                onFinalText(transcript);
            }
        }
    });

    const errorSub = mod.addSpeechRecognitionListener("error", (payload) => {
        const typed = payload as { message?: string; error?: string };
        onError(typed.message ?? typed.error ?? "Voice recognition error");
    });

    mod.ExpoSpeechRecognitionModule.start({
        interimResults: false,
        continuous: false,
    });

    return {
        stop: () => {
            resultSub.remove();
            errorSub.remove();
            try {
                mod.ExpoSpeechRecognitionModule.stop();
            } catch {
                // stop çağrısı abort olabilir; bilinçli olarak yut.
            }
        },
    };
}
