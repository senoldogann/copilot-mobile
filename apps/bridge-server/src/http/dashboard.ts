type BridgeStatusPayload = {
    status: {
        pid: number;
        port: number;
        publicUrl: string;
        companionId: string | null;
        daemonState: "starting" | "running" | "error" | "stopping";
        mode: "direct" | "hosted" | "self_hosted";
        copilotAuthenticated: boolean;
        lastError: string | null;
        lastPairingAt: number | null;
        logsDirectory: string | null;
        hostedApiBaseUrl: string | null;
        hostedRelayBaseUrl: string | null;
        sessionExpiresAt: number | null;
        relay: {
            connectedToRelay: boolean;
            connectedToLocalBridge: boolean;
            relayUrl: string;
        } | null;
        hasClient: boolean;
        pairingActive: boolean;
        qrExpiresAt: number | null;
    };
};

const dashboardStyles = `
    :root {
        color-scheme: dark;
        --bg: #101312;
        --panel: rgba(24, 28, 27, 0.92);
        --panel-border: rgba(255, 255, 255, 0.08);
        --text: #f3f5f4;
        --muted: #9aa6a2;
        --accent: #55d39a;
        --danger: #ff7b72;
        --warning: #f2c14e;
        --shadow: 0 20px 60px rgba(0, 0, 0, 0.35);
    }

    * { box-sizing: border-box; }

    body {
        margin: 0;
        font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background:
            radial-gradient(circle at top left, rgba(85, 211, 154, 0.20), transparent 35%),
            radial-gradient(circle at top right, rgba(66, 133, 244, 0.14), transparent 30%),
            linear-gradient(180deg, #0d100f 0%, #111514 100%);
        color: var(--text);
        min-height: 100vh;
    }

    .shell {
        max-width: 1100px;
        margin: 0 auto;
        padding: 40px 24px 56px;
    }

    .hero {
        display: flex;
        justify-content: space-between;
        gap: 24px;
        align-items: flex-start;
        margin-bottom: 28px;
    }

    .hero h1 {
        margin: 0 0 8px;
        font-size: clamp(32px, 6vw, 52px);
        line-height: 1;
        letter-spacing: -0.04em;
    }

    .hero p {
        margin: 0;
        color: var(--muted);
        max-width: 720px;
        line-height: 1.5;
    }

    .badge {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 10px 14px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid var(--panel-border);
        color: var(--muted);
        white-space: nowrap;
    }

    .dot {
        width: 9px;
        height: 9px;
        border-radius: 999px;
        background: var(--warning);
        box-shadow: 0 0 12px rgba(242, 193, 78, 0.45);
    }

    .dot.online { background: var(--accent); box-shadow: 0 0 12px rgba(85, 211, 154, 0.55); }
    .dot.offline { background: var(--danger); box-shadow: 0 0 12px rgba(255, 123, 114, 0.55); }

    .grid {
        display: grid;
        grid-template-columns: 1.3fr 0.9fr;
        gap: 20px;
    }

    .card {
        background: var(--panel);
        border: 1px solid var(--panel-border);
        border-radius: 24px;
        box-shadow: var(--shadow);
        overflow: hidden;
        backdrop-filter: blur(16px);
    }

    .card-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        padding: 20px 22px 14px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    }

    .card-head h2 {
        margin: 0;
        font-size: 18px;
        letter-spacing: -0.02em;
    }

    .card-body {
        padding: 20px 22px 24px;
    }

    .metrics {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 14px;
    }

    .metric {
        padding: 16px;
        border-radius: 18px;
        background: rgba(255, 255, 255, 0.03);
        border: 1px solid rgba(255, 255, 255, 0.05);
    }

    .metric-label {
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--muted);
        margin-bottom: 8px;
    }

    .metric-value {
        font-size: 16px;
        line-height: 1.4;
        word-break: break-word;
    }

    .actions {
        display: flex;
        gap: 12px;
        flex-wrap: wrap;
        margin-bottom: 16px;
    }

    button {
        appearance: none;
        border: 0;
        border-radius: 14px;
        padding: 12px 16px;
        font: inherit;
        background: #1f6feb;
        color: white;
        cursor: pointer;
        transition: transform 140ms ease, opacity 140ms ease;
    }

    button.secondary {
        background: rgba(255, 255, 255, 0.08);
        color: var(--text);
    }

    button:disabled {
        opacity: 0.5;
        cursor: wait;
    }

    button:hover:not(:disabled) {
        transform: translateY(-1px);
    }

    .status-line {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 10px 0;
        border-bottom: 1px solid rgba(255, 255, 255, 0.05);
        color: var(--muted);
    }

    .status-line:last-child {
        border-bottom: 0;
        padding-bottom: 0;
    }

    .status-line strong {
        color: var(--text);
        font-weight: 600;
        text-align: right;
    }

    .qr-shell {
        display: flex;
        flex-direction: column;
        gap: 14px;
    }

    .qr-meta {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
    }

    .pill {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid rgba(255, 255, 255, 0.08);
        padding: 8px 12px;
        color: var(--muted);
        font-size: 13px;
    }

    pre {
        margin: 0;
        padding: 16px;
        border-radius: 18px;
        background: #0b0d0d;
        border: 1px solid rgba(255, 255, 255, 0.06);
        color: #d4f7e6;
        overflow: auto;
        font-size: 11px;
        line-height: 1.05;
    }

    .empty {
        color: var(--muted);
        padding: 20px;
        text-align: center;
        border-radius: 18px;
        border: 1px dashed rgba(255, 255, 255, 0.12);
    }

    .hint {
        color: var(--muted);
        font-size: 13px;
        line-height: 1.5;
        margin-top: 14px;
    }

    @media (max-width: 900px) {
        .grid {
            grid-template-columns: 1fr;
        }

        .hero {
            flex-direction: column;
        }
    }
`;

export function renderCompanionDashboard(): string {
    return `<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Copilot Mobile Companion</title>
    <style>${dashboardStyles}</style>
</head>
<body>
    <main class="shell">
        <section class="hero">
            <div>
                <h1>Companion Dashboard</h1>
                <p>
                    This local dashboard keeps the desktop bridge, relay link, pairing state, and QR handoff visible
                    without relying on the terminal. It is the first step toward the full macOS companion app.
                </p>
            </div>
            <div class="badge">
                <span class="dot" id="hero-dot"></span>
                <span id="hero-label">Connecting…</span>
            </div>
        </section>

        <section class="grid">
            <article class="card">
                <div class="card-head">
                    <h2>Bridge Status</h2>
                    <button class="secondary" id="refresh-status" type="button">Refresh</button>
                </div>
                <div class="card-body">
                    <div class="metrics">
                        <div class="metric">
                            <div class="metric-label">Mobile Socket</div>
                            <div class="metric-value" id="public-url">-</div>
                        </div>
                        <div class="metric">
                            <div class="metric-label">Companion ID</div>
                            <div class="metric-value" id="companion-id">-</div>
                        </div>
                        <div class="metric">
                            <div class="metric-label">Bridge PID</div>
                            <div class="metric-value" id="bridge-pid">-</div>
                        </div>
                        <div class="metric">
                            <div class="metric-label">Companion Mode</div>
                            <div class="metric-value" id="companion-mode">-</div>
                        </div>
                    </div>

                    <div style="margin-top: 18px;">
                        <div class="status-line"><span>Copilot authentication</span><strong id="copilot-auth">-</strong></div>
                        <div class="status-line"><span>Relay control-plane</span><strong id="relay-api">-</strong></div>
                        <div class="status-line"><span>Relay WebSocket base</span><strong id="relay-base">-</strong></div>
                        <div class="status-line"><span>Mobile client attached</span><strong id="has-client">-</strong></div>
                        <div class="status-line"><span>Pairing token active</span><strong id="pairing-active">-</strong></div>
                        <div class="status-line"><span>Last pairing</span><strong id="last-pairing">-</strong></div>
                        <div class="status-line"><span>QR expires</span><strong id="qr-expires">-</strong></div>
                        <div class="status-line"><span>Relay session expires</span><strong id="session-expires">-</strong></div>
                        <div class="status-line"><span>Relay URL</span><strong id="relay-url">-</strong></div>
                        <div class="status-line"><span>Relay connected</span><strong id="relay-connected">-</strong></div>
                        <div class="status-line"><span>Local bridge linked</span><strong id="relay-local">-</strong></div>
                        <div class="status-line"><span>Last error</span><strong id="last-error">-</strong></div>
                    </div>
                </div>
            </article>

            <article class="card">
                <div class="card-head">
                    <h2>Pairing QR</h2>
                    <div class="actions">
                        <button id="generate-qr" type="button">Generate QR</button>
                        <button class="secondary" id="open-logs" type="button">Open Logs</button>
                        <button class="secondary" id="stop-service" type="button">Stop Service</button>
                    </div>
                </div>
                <div class="card-body">
                    <div class="qr-shell">
                        <div class="qr-meta">
                            <div class="pill">Mode: <strong id="qr-mode">-</strong></div>
                            <div class="pill">Version: <strong id="qr-version">-</strong></div>
                        </div>
                        <pre id="qr-ascii" class="empty">Generate a QR code to pair a phone.</pre>
                        <div class="hint" id="qr-hint">
                            The QR points the phone at the currently active public socket URL. In relay mode, the URL
                            already includes the companion route.
                        </div>
                    </div>
                </div>
            </article>
        </section>
    </main>

    <script>
        const statusPath = "/__copilot_mobile/status";
        const qrPath = "/__copilot_mobile/qr";
        const openLogsPath = "/__copilot_mobile/open-logs";
        const stopServicePath = "/__copilot_mobile/stop";

        const heroDot = document.getElementById("hero-dot");
        const heroLabel = document.getElementById("hero-label");

        const fields = {
            publicUrl: document.getElementById("public-url"),
            companionId: document.getElementById("companion-id"),
            bridgePid: document.getElementById("bridge-pid"),
            companionMode: document.getElementById("companion-mode"),
            copilotAuth: document.getElementById("copilot-auth"),
            relayApi: document.getElementById("relay-api"),
            relayBase: document.getElementById("relay-base"),
            hasClient: document.getElementById("has-client"),
            pairingActive: document.getElementById("pairing-active"),
            lastPairing: document.getElementById("last-pairing"),
            qrExpires: document.getElementById("qr-expires"),
            sessionExpires: document.getElementById("session-expires"),
            relayUrl: document.getElementById("relay-url"),
            relayConnected: document.getElementById("relay-connected"),
            relayLocal: document.getElementById("relay-local"),
            lastError: document.getElementById("last-error"),
            qrMode: document.getElementById("qr-mode"),
            qrVersion: document.getElementById("qr-version"),
            qrAscii: document.getElementById("qr-ascii"),
        };

        function setText(element, value) {
            element.textContent = value;
        }

        function setBoolText(element, value) {
            setText(element, value ? "Yes" : "No");
        }

        function formatTime(timestamp) {
            if (timestamp === null) return "-";
            return new Date(timestamp).toLocaleString();
        }

        function setHeroState(kind, label) {
            heroDot.className = "dot " + kind;
            heroLabel.textContent = label;
        }

        function applyStatus(payload) {
            const status = payload.status;
            setText(fields.publicUrl, status.publicUrl);
            setText(fields.companionId, status.companionId ?? "-");
            setText(fields.bridgePid, String(status.pid));
            setText(fields.companionMode, status.mode);
            setText(fields.copilotAuth, status.copilotAuthenticated ? "Ready" : "Missing");
            setText(fields.relayApi, status.hostedApiBaseUrl ?? "-");
            setText(fields.relayBase, status.hostedRelayBaseUrl ?? "-");
            setBoolText(fields.hasClient, status.hasClient);
            setBoolText(fields.pairingActive, status.pairingActive);
            setText(fields.lastPairing, formatTime(status.lastPairingAt));
            setText(fields.qrExpires, formatTime(status.qrExpiresAt));
            setText(fields.sessionExpires, formatTime(status.sessionExpiresAt));
            setText(fields.relayUrl, status.relay?.relayUrl ?? "-");
            setBoolText(fields.relayConnected, status.relay?.connectedToRelay ?? false);
            setBoolText(fields.relayLocal, status.relay?.connectedToLocalBridge ?? false);
            setText(fields.lastError, status.lastError ?? "-");

            if (status.lastError !== null) {
                setHeroState("offline", "Action needed");
                return;
            }

            if (status.hasClient === true) {
                setHeroState("online", "Phone connected");
                return;
            }

            if (status.relay?.connectedToRelay === true && status.copilotAuthenticated === true) {
                setHeroState("online", "Relay linked");
                return;
            }

            if (status.copilotAuthenticated === true) {
                setHeroState("offline", "Ready to pair");
                return;
            }

            setHeroState("offline", "Copilot login required");
        }

        async function loadStatus() {
            const response = await fetch(statusPath);
            if (!response.ok) {
                throw new Error("Status request failed");
            }
            const payload = await response.json();
            applyStatus(payload);
            return payload;
        }

        async function generateQr() {
            const button = document.getElementById("generate-qr");
            button.disabled = true;
            try {
                const response = await fetch(qrPath, { method: "POST" });
                if (!response.ok) {
                    throw new Error("QR request failed");
                }
                const payload = await response.json();
                applyStatus(payload);
                setText(fields.qrMode, payload.qrCode.payload.transportMode);
                setText(fields.qrVersion, String(payload.qrCode.payload.version));
                fields.qrAscii.textContent = payload.qrCode.ascii;
            } finally {
                button.disabled = false;
            }
        }

        async function openLogs() {
            await fetch(openLogsPath, { method: "POST" });
        }

        async function stopService() {
            await fetch(stopServicePath, { method: "POST" });
            setHeroState("offline", "Stopping companion");
        }

        document.getElementById("refresh-status").addEventListener("click", () => {
            loadStatus().catch(() => setHeroState("offline", "Bridge unavailable"));
        });
        document.getElementById("generate-qr").addEventListener("click", () => {
            generateQr().catch(() => setHeroState("offline", "QR generation failed"));
        });
        document.getElementById("open-logs").addEventListener("click", () => {
            openLogs().catch(() => setHeroState("offline", "Could not open logs"));
        });
        document.getElementById("stop-service").addEventListener("click", () => {
            stopService().catch(() => setHeroState("offline", "Stop request failed"));
        });

        loadStatus().catch(() => setHeroState("offline", "Bridge unavailable"));
        setInterval(() => {
            loadStatus().catch(() => setHeroState("offline", "Bridge unavailable"));
        }, 3000);
    </script>
</body>
</html>`;
}
