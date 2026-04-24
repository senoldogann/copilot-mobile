import {
    shouldAutoStopVoiceCapture,
    shouldDismissVoiceInputError,
} from "../voice-input";

describe("voice input helpers", () => {
    it("suppresses empty no-speech failures", () => {
        expect(shouldDismissVoiceInputError("no-speech", "", false)).toBe(true);
        expect(shouldDismissVoiceInputError("speech-timeout", "", false)).toBe(true);
    });

    it("suppresses no-speech errors when partial text was already captured", () => {
        expect(shouldDismissVoiceInputError("no-speech", "hello world", true)).toBe(true);
    });

    it("keeps non-recoverable errors visible", () => {
        expect(shouldDismissVoiceInputError("network", "", false)).toBe(false);
    });

    it("auto-stops once a final transcript arrives", () => {
        expect(shouldAutoStopVoiceCapture(true, "draft a plan")).toBe(true);
        expect(shouldAutoStopVoiceCapture(false, "draft a plan")).toBe(false);
        expect(shouldAutoStopVoiceCapture(true, "   ")).toBe(false);
    });
});
