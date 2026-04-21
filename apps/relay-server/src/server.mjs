import { createServer } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import { verifyRelayAccessToken } from "./auth.mjs";

const port = Number.parseInt(process.env.RELAY_PORT ?? "", 10) || 8787;
const AUTH_FRAME_TIMEOUT_MS = 5_000;

function parseConnectionPath(url) {
  const parsed = new URL(url ?? "/", "http://127.0.0.1");
  const parts = parsed.pathname.split("/").filter(Boolean);
  if (parts.length !== 3 || parts[0] !== "connect") {
    return null;
  }

  const role = parts[1];
  const companionId = decodeURIComponent(parts[2] ?? "");
  if ((role !== "mobile" && role !== "companion") || companionId.length === 0) {
    return null;
  }

  return { role, companionId };
}

function sendJson(ws, payload) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function closeWithPolicyViolation(ws, message) {
  ws.close(1008, message);
}

const rooms = new Map();

function getOrCreateRoom(companionId) {
  const existing = rooms.get(companionId);
  if (existing !== undefined) {
    return existing;
  }

  const room = { companion: null, mobile: null };
  rooms.set(companionId, room);
  return room;
}

function cleanupRoom(companionId) {
  const room = rooms.get(companionId);
  if (room === undefined) {
    return;
  }

  if (room.companion === null && room.mobile === null) {
    rooms.delete(companionId);
  }
}

const httpServer = createServer((req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, roomCount: rooms.size }));
    return;
  }

  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
});

const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });

wss.on("connection", (ws, req, meta) => {
  const { role, companionId } = meta;
  let authenticated = false;
  const authTimeout = setTimeout(() => {
    if (!authenticated && ws.readyState === WebSocket.OPEN) {
      closeWithPolicyViolation(ws, "Relay authentication timeout");
    }
  }, AUTH_FRAME_TIMEOUT_MS);

  function clearAuthTimeout() {
    clearTimeout(authTimeout);
  }

  function attachAuthenticatedConnection() {
    const room = getOrCreateRoom(companionId);

    if (role === "companion") {
      if (room.companion !== null && room.companion !== ws) {
        room.companion.close(1012, "Replaced by newer companion connection");
      }
      room.companion = ws;

      sendJson(ws, {
        type: "companion.ready",
        companionId,
      });

      if (room.mobile !== null) {
        sendJson(ws, {
          type: "mobile.open",
          companionId,
        });
      }

      ws.on("message", (raw) => {
        let parsed;
        try {
          parsed = JSON.parse(String(raw));
        } catch {
          return;
        }

        if (typeof parsed !== "object" || parsed === null || typeof parsed.type !== "string") {
          return;
        }

        if (parsed.type === "mobile.message" && typeof parsed.data === "string") {
          if (room.mobile !== null && room.mobile.readyState === WebSocket.OPEN) {
            room.mobile.send(parsed.data);
          }
          return;
        }

        if (parsed.type === "mobile.close") {
          if (room.mobile !== null) {
            room.mobile.close(1000, typeof parsed.reason === "string" ? parsed.reason : "Closed by companion");
            room.mobile = null;
            cleanupRoom(companionId);
          }
        }
      });

      ws.on("close", () => {
        if (room.companion === ws) {
          room.companion = null;
        }
        if (room.mobile !== null) {
          room.mobile.close(1013, "Companion offline");
          room.mobile = null;
        }
        cleanupRoom(companionId);
      });

      return;
    }

    if (room.mobile !== null && room.mobile !== ws) {
      room.mobile.close(1012, "Replaced by newer mobile connection");
    }
    room.mobile = ws;

    if (room.companion === null || room.companion.readyState !== WebSocket.OPEN) {
      ws.close(1013, "Companion offline");
      room.mobile = null;
      cleanupRoom(companionId);
      return;
    }

    sendJson(room.companion, {
      type: "mobile.open",
      companionId,
    });

    ws.on("message", (raw) => {
      if (room.companion !== null && room.companion.readyState === WebSocket.OPEN) {
        sendJson(room.companion, {
          type: "mobile.message",
          companionId,
          data: String(raw),
        });
      }
    });

    ws.on("close", () => {
      if (room.mobile === ws) {
        room.mobile = null;
        if (room.companion !== null && room.companion.readyState === WebSocket.OPEN) {
          sendJson(room.companion, {
            type: "mobile.close",
            companionId,
            reason: "Mobile disconnected",
          });
        }
      }
      cleanupRoom(companionId);
    });
  }

  ws.on("message", (raw) => {
    if (authenticated) {
      return;
    }

    let parsed;
    try {
      parsed = JSON.parse(String(raw));
    } catch {
      closeWithPolicyViolation(ws, "Relay authentication payload must be valid JSON");
      return;
    }

    if (
      typeof parsed !== "object"
      || parsed === null
      || parsed.type !== "relay.connect"
      || parsed.role !== role
      || typeof parsed.accessToken !== "string"
    ) {
      closeWithPolicyViolation(ws, "Relay authentication payload is invalid");
      return;
    }

    try {
      verifyRelayAccessToken(parsed.accessToken, role, companionId);
    } catch {
      closeWithPolicyViolation(ws, "Relay authentication failed");
      return;
    }

    authenticated = true;
    clearAuthTimeout();
    attachAuthenticatedConnection();
  });

  ws.on("close", () => {
    clearAuthTimeout();
  });
});

httpServer.on("upgrade", (req, socket, head) => {
  const parsed = parseConnectionPath(req.url);
  if (parsed === null) {
    socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit("connection", ws, req, parsed);
  });
});

httpServer.listen(port, () => {
  console.log(`[relay] Listening on ws://0.0.0.0:${port}`);
});
