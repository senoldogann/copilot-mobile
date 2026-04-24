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

function installMockWebSocket(socket: FakeWebSocket): void {
    globalThis.WebSocket = Object.assign(
        jest.fn(() => socket),
        {
            CONNECTING: FakeWebSocket.CONNECTING,
            OPEN: FakeWebSocket.OPEN,
            CLOSING: FakeWebSocket.CLOSING,
            CLOSED: FakeWebSocket.CLOSED,
        }
    ) as unknown as typeof WebSocket;
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
        installMockWebSocket(socket);

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

    it("keeps unsent queued messages pending for a later flush when the socket closes mid-drain", async () => {
        const socket = new FakeWebSocket();
        installMockWebSocket(socket);

        const client = createWSClient({
            onMessage: () => undefined,
            onStateChange: () => undefined,
            onError: () => undefined,
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

        const firstSend = client.sendMessage("capabilities.request", {});
        const secondSend = client.sendMessage("models.request", {});

        socket.readyState = FakeWebSocket.OPEN;
        let sendCount = 0;
        socket.send.mockImplementation(() => {
            sendCount += 1;
            if (sendCount === 1) {
                socket.readyState = FakeWebSocket.CLOSED;
            }
        });

        client.flushPending();
        await expect(firstSend).resolves.toBeUndefined();

        let secondSettled = false;
        void secondSend.then(() => {
            secondSettled = true;
        });
        await Promise.resolve();

        expect(secondSettled).toBe(false);
        expect(socket.send).toHaveBeenCalledTimes(1);

        socket.readyState = FakeWebSocket.OPEN;
        client.flushPending();

        try {
            await expect(secondSend).resolves.toBeUndefined();
            expect(socket.send).toHaveBeenCalledTimes(2);
        } finally {
            client.disconnect();
        }
    });
});
