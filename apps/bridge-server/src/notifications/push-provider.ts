const EXPO_PUSH_ENDPOINT = "https://exp.host/--/api/v2/push/send";
const SESSION_EVENTS_CHANNEL_ID = "session-events";
const PUSH_REQUEST_TIMEOUT_MS = 10_000;
const PUSH_MAX_ATTEMPTS = 3;
const PUSH_RETRY_DELAY_MS = 900;

type ExpoPushTicket = {
    status?: string;
    message?: string;
    details?: {
        error?: string;
    };
};

export type PushSendResult =
    | { ok: true }
    | {
        ok: false;
        invalidToken: boolean;
        retryable: boolean;
        error: string;
        details?: string;
    };

function isExpoPushToken(token: string): boolean {
    return /^ExponentPushToken\[[^\]]+\]$/.test(token) || /^ExpoPushToken\[[^\]]+\]$/.test(token);
}

function readFirstTicket(payload: unknown): ExpoPushTicket | null {
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
        return null;
    }

    const value = payload as Record<string, unknown>;
    if (!Array.isArray(value["data"])) {
        return null;
    }

    const firstTicket = value["data"][0];
    if (typeof firstTicket !== "object" || firstTicket === null || Array.isArray(firstTicket)) {
        return null;
    }

    return firstTicket as ExpoPushTicket;
}

function sleep(milliseconds: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, milliseconds);
    });
}

export function createPushProvider() {
    return {
        async sendCompletionPush(input: {
            pushToken: string;
            sessionId: string;
            title: string;
            body: string;
        }): Promise<PushSendResult> {
            if (!isExpoPushToken(input.pushToken)) {
                return {
                    ok: false,
                    invalidToken: true,
                    retryable: false,
                    error: "Push token is not a valid Expo push token",
                };
            }

            for (let attempt = 1; attempt <= PUSH_MAX_ATTEMPTS; attempt += 1) {
                let result: PushSendResult;
                let response: Response;

                try {
                    response = await fetch(EXPO_PUSH_ENDPOINT, {
                        method: "POST",
                        headers: {
                            "content-type": "application/json",
                            accept: "application/json",
                        },
                        body: JSON.stringify({
                            to: input.pushToken,
                            title: input.title,
                            body: input.body,
                            sound: "default",
                            channelId: SESSION_EVENTS_CHANNEL_ID,
                            data: {
                                sessionId: input.sessionId,
                                kind: "session-complete",
                            },
                        }),
                        signal: AbortSignal.timeout(PUSH_REQUEST_TIMEOUT_MS),
                    });
                } catch (error) {
                    result = {
                        ok: false,
                        invalidToken: false,
                        retryable: true,
                        error: error instanceof Error ? error.message : String(error),
                    };

                    if (attempt < PUSH_MAX_ATTEMPTS) {
                        console.warn("[notifications] Retryable Expo push transport failure", {
                            sessionId: input.sessionId,
                            attempt,
                            maxAttempts: PUSH_MAX_ATTEMPTS,
                            error: result.error,
                        });
                        await sleep(PUSH_RETRY_DELAY_MS * attempt);
                        continue;
                    }

                    return result;
                }

                const rawBody = await response.text();
                if (!response.ok) {
                    result = {
                        ok: false,
                        invalidToken: false,
                        retryable: response.status >= 500,
                        error: `Expo push request failed with status ${response.status}`,
                        details: rawBody,
                    };
                } else {
                    let parsed: unknown;
                    try {
                        parsed = JSON.parse(rawBody) as unknown;
                    } catch {
                        return {
                            ok: false,
                            invalidToken: false,
                            retryable: false,
                            error: "Expo push response was not valid JSON",
                            details: rawBody,
                        };
                    }

                    const ticket = readFirstTicket(parsed);
                    if (ticket?.status === "ok") {
                        return { ok: true };
                    }

                    const providerError = ticket?.details?.error;
                    result = {
                        ok: false,
                        invalidToken: providerError === "DeviceNotRegistered",
                        retryable: false,
                        error: ticket?.message ?? "Expo push rejected the completion notification",
                        ...(providerError !== undefined ? { details: providerError } : {}),
                    };
                }

                if (!result.retryable || attempt >= PUSH_MAX_ATTEMPTS) {
                    return result;
                }

                console.warn("[notifications] Retryable Expo push rejection", {
                    sessionId: input.sessionId,
                    attempt,
                    maxAttempts: PUSH_MAX_ATTEMPTS,
                    error: result.error,
                    details: result.details,
                });
                await sleep(PUSH_RETRY_DELAY_MS * attempt);
            }

            return {
                ok: false,
                invalidToken: false,
                retryable: false,
                error: "Expo push retry loop exhausted without a terminal result",
            };
        },
    };
}
