import { shouldClearStoredCredentialsAfterSilentDirectResumeFailure } from "../reconnect-policy";

describe("silent direct resume credential policy", () => {
    it("keeps stored credentials for transient transport failures", () => {
        expect(
            shouldClearStoredCredentialsAfterSilentDirectResumeFailure("Connection closed unexpectedly")
        ).toBe(false);
        expect(
            shouldClearStoredCredentialsAfterSilentDirectResumeFailure("WebSocket connection error")
        ).toBe(false);
        expect(
            shouldClearStoredCredentialsAfterSilentDirectResumeFailure(
                "Authentication timed out while connecting to your Mac companion"
            )
        ).toBe(false);
        expect(
            shouldClearStoredCredentialsAfterSilentDirectResumeFailure(null)
        ).toBe(false);
    });

    it("clears stored credentials only for fatal trust or auth failures", () => {
        expect(
            shouldClearStoredCredentialsAfterSilentDirectResumeFailure(
                "[AUTH_ERROR] Invalid device credential"
            )
        ).toBe(true);
        expect(
            shouldClearStoredCredentialsAfterSilentDirectResumeFailure(
                "Certificate verification failed — server is not trusted"
            )
        ).toBe(true);
    });
});
