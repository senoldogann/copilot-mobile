export function shouldDismissVoiceInputError(
    errorCode: string,
    transcript: string,
    heardSpeech: boolean
): boolean {
    if (errorCode === "aborted") {
        return true;
    }

    if (errorCode !== "no-speech" && errorCode !== "speech-timeout") {
        return false;
    }

    if (transcript.trim().length > 0) {
        return true;
    }

    return !heardSpeech;
}

export function shouldAutoStopVoiceCapture(isFinal: boolean, transcript: string): boolean {
    return isFinal && transcript.trim().length > 0;
}
