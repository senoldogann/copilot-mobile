// Copilot Mobile Bridge Server — main entry point

import { createCopilotAdapter } from "./copilot/client.js";
import { createBridgeServer } from "./ws/server.js";
import { displayQRCode } from "./auth/qr.js";

async function main(): Promise<void> {
    console.log("Starting Copilot Mobile Bridge...\n");

    // Create Copilot SDK adapter
    const copilotClient = createCopilotAdapter();

    // Check SDK availability
    const available = await copilotClient.isAvailable();
    if (!available) {
        console.warn("[copilot] Copilot CLI not reachable. Make sure you are signed in with your GitHub account.");
        console.warn("[copilot] Starting bridge server anyway (connection attempts will continue)...\n");
    } else {
        console.log("[copilot] Copilot CLI connection successful\n");
    }

    // Start WebSocket server
    const wsServer = createBridgeServer(copilotClient);
    await wsServer.start();

    // Display QR code
    await displayQRCode(wsServer.port);

    // Graceful shutdown
    const shutdown = async () => {
        console.log("\nShutting down...");
        await wsServer.shutdown();
        process.exit(0);
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
}

main().catch((err) => {
    console.error("Failed to start bridge server:", err);
    process.exit(1);
});
