import { createWSClient } from "../ws-client";

type WebSocketHandler = (() => void) | null;

class FakeWebSocket {
    public static readonly CONNECTING = 0;
    public static readonly OPEN = 1;
    public static readonly CLOSING = 2;
    public static readonly CLOSED = 3;

    public readyState = FakeWebSocket.CONNECTING;
    public onopen: WebSocketHandler = null;
    public onclose: WebSocketHandler = null;
    public onmessage: ((event: { data: string }) => void) | null = null;
    public onerror: WebSocketHandler = null;

    public close = jest.fn(() => {
        this.readyState = FakeWebSocket.CLOSED;
    });

    public send = jest.fn();
}

describe("createWSClient", () => {
    const OriginalWebSocket = globalThis.WebSocket;

    afterEach(() => {
        jest.useRealTimers();
        globalThis.WebSocket = OriginalWebSocket;
    });

    it("recovers to disconnected after a websocket error that never closes", () => {
        jest.useFakeTimers();

        const socket = new FakeWebSocket();
        globalThis.WebSocket = jest.fn(() => socket) as unknown as typeof WebSocket;

        const stateChanges: Array<string> = [];
        const reportedErrors: Array<string> = [];

        const client = createWSClient({
            onMessage: () => undefined,
            onStateChange: (state) => {
                stateChanges.push(state);
            },
            onError: (error) => {
                reportedErrors.push(error);
            },
        });

        client.seedStoredCredentials({
            deviceCredential: "device-credential",
            serverUrl: "ws://127.0.0.1:29877",
            certFingerprint: null,
            transportMode: "direct",
            relayAccessToken: null,
        });

        expect(client.resume({
            reconnectOnFailure: true,
            reportErrors: true,
        })).toBe(true);

        socket.onerror?.();
        jest.advanceTimersByTime(300);

        expect(client.getState()).toBe("disconnected");
        expect(stateChanges).toContain("connecting");
        expect(stateChanges).toContain("disconnected");
        expect(reportedErrors).toContain("WebSocket connection error");
        expect(socket.close).toHaveBeenCalled();
    });
});
