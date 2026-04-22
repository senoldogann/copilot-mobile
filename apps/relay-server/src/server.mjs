import { createServer } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import {
  createCompanionRegistrationCredential,
  createRelayAccessToken,
  getCompanionAccessTokenTtlMs,
  verifyCompanionRegistrationCredential,
  verifyRelayAccessToken,
} from "./auth.mjs";

const port = Number.parseInt(process.env.RELAY_PORT ?? "", 10) || 8787;
const AUTH_FRAME_TIMEOUT_MS = 5_000;
const CONTROL_PLANE_RATE_LIMIT_WINDOW_MS = 60 * 1000;
const REGISTER_RATE_LIMIT_MAX = 10;
const SESSION_RATE_LIMIT_MAX = 60;
const rateLimitBuckets = new Map();

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

function getClientAddress(req) {
  const forwardedFor = req.headers["x-forwarded-for"];
  if (typeof forwardedFor === "string" && forwardedFor.trim().length > 0) {
    return forwardedFor.split(",")[0]?.trim() ?? "unknown";
  }

  return req.socket.remoteAddress ?? "unknown";
}

function isLoopbackAddress(address) {
  return address === "::1"
    || address === "127.0.0.1"
    || address === "::ffff:127.0.0.1";
}

function checkRateLimit(bucketKey, limit) {
  const now = Date.now();
  const existing = rateLimitBuckets.get(bucketKey) ?? [];
  const nextEntries = existing.filter((timestamp) => now - timestamp < CONTROL_PLANE_RATE_LIMIT_WINDOW_MS);
  if (nextEntries.length >= limit) {
    rateLimitBuckets.set(bucketKey, nextEntries);
    return false;
  }

  nextEntries.push(now);
  rateLimitBuckets.set(bucketKey, nextEntries);
  return true;
}

function assertControlPlaneRateLimit(req, limitKey, limit) {
  const clientAddress = getClientAddress(req);
  if (!checkRateLimit(`${limitKey}:${clientAddress}`, limit)) {
    const error = new Error("Rate limit exceeded.");
    error.statusCode = 429;
    throw error;
  }
}

function assertRegistrationAllowed(req) {
  const allowPublicRegistration = process.env.COPILOT_MOBILE_ALLOW_PUBLIC_REGISTRATION === "1";
  if (allowPublicRegistration) {
    return;
  }

  const clientAddress = getClientAddress(req);
  if (!isLoopbackAddress(clientAddress)) {
    const error = new Error(
      "Public companion registration is disabled by default. Use localhost for development or provide a trusted hosted control-plane in production."
    );
    error.statusCode = 403;
    throw error;
  }
}

function getOriginBaseUrl(req, envName, defaultProtocol) {
  const explicit = process.env[envName];
  if (typeof explicit === "string" && explicit.trim().length > 0) {
    return explicit.trim().replace(/\/$/, "");
  }

  const forwardedProto = req.headers["x-forwarded-proto"];
  const protocol = typeof forwardedProto === "string"
    ? forwardedProto
    : (req.socket.encrypted ? "https" : defaultProtocol);
  const forwardedHost = req.headers["x-forwarded-host"];
  const hostHeader = typeof forwardedHost === "string"
    ? forwardedHost
    : req.headers.host;
  if (typeof hostHeader !== "string" || hostHeader.length === 0) {
    throw new Error("Host header is required.");
  }

  return `${protocol}://${hostHeader}`.replace(/\/$/, "");
}

function buildSocketUrl(baseUrl, role, companionId) {
  const parsedUrl = new URL(baseUrl);
  parsedUrl.protocol = parsedUrl.protocol === "https:" ? "wss:" : "ws:";
  parsedUrl.pathname = `/connect/${role}/${encodeURIComponent(companionId)}`;
  parsedUrl.search = "";
  parsedUrl.hash = "";
  return parsedUrl.toString();
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let rawBody = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      rawBody += chunk;
    });
    req.on("end", () => {
      if (rawBody.trim().length === 0) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(rawBody));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function createSessionPayload(req, companionId) {
  const relayBaseUrl = getOriginBaseUrl(req, "COPILOT_MOBILE_PUBLIC_RELAY_BASE_URL", "http");
  const expiresAt = Date.now() + getCompanionAccessTokenTtlMs();

  return {
    companionId,
    mobileSocketUrl: buildSocketUrl(relayBaseUrl, "mobile", companionId),
    companionSocketUrl: buildSocketUrl(relayBaseUrl, "companion", companionId),
    mobileAccessToken: createRelayAccessToken("mobile", companionId),
    companionAccessToken: createRelayAccessToken("companion", companionId),
    expiresAt,
  };
}

function writeJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "content-type": "application/json" });
  res.end(JSON.stringify(payload));
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

const httpServer = createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/health") {
      writeJson(res, 200, { ok: true, roomCount: rooms.size });
      return;
    }

    if (req.method === "POST" && req.url === "/v1/companions/register") {
      assertRegistrationAllowed(req);
      assertControlPlaneRateLimit(req, "register", REGISTER_RATE_LIMIT_MAX);
      const body = await readJsonBody(req);
      const { companionId, companionRegistrationCredential } = createCompanionRegistrationCredential({
        hostname: typeof body.hostname === "string" ? body.hostname : "unknown-host",
        platform: typeof body.platform === "string" ? body.platform : "unknown-platform",
      });

      writeJson(res, 200, {
        companionId,
        companionRegistrationCredential,
      });
      return;
    }

    if (req.method === "POST" && req.url === "/v1/companions/session") {
      assertControlPlaneRateLimit(req, "session", SESSION_RATE_LIMIT_MAX);
      const body = await readJsonBody(req);
      if (typeof body.companionRegistrationCredential !== "string") {
        writeJson(res, 400, { error: "companionRegistrationCredential is required." });
        return;
      }

      const registration = verifyCompanionRegistrationCredential(body.companionRegistrationCredential);
      writeJson(res, 200, createSessionPayload(req, registration.companionId));
      return;
    }

    if (req.method === "POST" && req.url === "/v1/companions/session/refresh") {
      assertControlPlaneRateLimit(req, "session_refresh", SESSION_RATE_LIMIT_MAX);
      const body = await readJsonBody(req);
      if (typeof body.companionRegistrationCredential !== "string") {
        writeJson(res, 400, { error: "companionRegistrationCredential is required." });
        return;
      }

      const registration = verifyCompanionRegistrationCredential(
        body.companionRegistrationCredential,
        typeof body.companionId === "string" ? body.companionId : undefined,
      );
      writeJson(res, 200, createSessionPayload(req, registration.companionId));
      return;
    }

    writeJson(res, 404, { error: "Not found" });
  } catch (error) {
    if (typeof error === "object" && error !== null && "statusCode" in error) {
      writeJson(res, Number(error.statusCode), {
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    writeJson(res, 500, { error: message });
  }
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
  console.log(`[relay] Listening on http://0.0.0.0:${port}`);
});
