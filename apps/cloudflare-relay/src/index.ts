import { DurableObject as CloudflareDurableObject } from "cloudflare:workers";
import { SignJWT, jwtVerify } from "jose";

type RelayRole = "mobile" | "companion";

type CompanionRegistrationPayload = {
    kind: "companion_registration";
    companionId: string;
    issuedAt: number;
    hostname: string;
    platform: string;
};

type RelayAccessPayload = {
    kind: "relay_access";
    role: RelayRole;
    companionId: string;
    issuedAt: number;
};

type WebSocketAttachment = {
    role: RelayRole;
    companionId: string;
    authenticated: boolean;
};

type ControlPlaneRequest = {
    hostname?: unknown;
    platform?: unknown;
    companionRegistrationCredential?: unknown;
    companionId?: unknown;
};

type SessionPayload = {
    companionId: string;
    mobileSocketUrl: string;
    companionSocketUrl: string;
    mobileAccessToken: string;
    companionAccessToken: string;
    expiresAt: number;
};

type RateLimitRequest = {
    key: string;
    limit: number;
    windowMs: number;
};

type HttpError = {
    status: number;
    message: string;
};

type Env = {
    COMPANION_ROOMS: DurableObjectNamespace<CompanionRoom>;
    RATE_LIMITER: DurableObjectNamespace<RateLimiter>;
    RELAY_SECRET: string;
    CONTROL_PLANE_SECRET?: string;
    PUBLIC_RELAY_BASE_URL?: string;
};

const AUTH_FRAME_TIMEOUT_MS = 5_000;
const REGISTER_RATE_LIMIT_MAX = 10;
const SESSION_RATE_LIMIT_MAX = 60;
const RATE_LIMIT_WINDOW_MS = 60_000;
const SOCKET_CONNECT_RATE_LIMIT_MAX = 180;
const SOCKET_CONNECT_WINDOW_MS = 60_000;
const COMPANION_ACCESS_TOKEN_TTL_SECONDS = 24 * 60 * 60;
const MOBILE_ACCESS_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
const REGISTRATION_CREDENTIAL_TTL_SECONDS = 365 * 24 * 60 * 60;
const MIN_SECRET_BYTES = 32;

function getRequiredSecret(secret: string | undefined, label: string): string {
    if (typeof secret !== "string" || secret.trim().length === 0) {
        throw new Error(`Missing required ${label}.`);
    }

    const normalizedSecret = secret.trim();
    if (new TextEncoder().encode(normalizedSecret).length < MIN_SECRET_BYTES) {
        throw new Error(`${label} must be at least ${MIN_SECRET_BYTES} bytes of high-entropy secret material.`);
    }

    if (/^(changeme|password|secret|test|dev|relay-test-secret)$/i.test(normalizedSecret)) {
        throw new Error(`${label} is too weak. Generate a random secret instead.`);
    }

    return normalizedSecret;
}

function getControlPlaneSecret(env: Env): string {
    if (typeof env.CONTROL_PLANE_SECRET === "string" && env.CONTROL_PLANE_SECRET.trim().length > 0) {
        return env.CONTROL_PLANE_SECRET.trim();
    }

    return getRequiredSecret(env.RELAY_SECRET, "RELAY_SECRET");
}

function getRelaySecret(env: Env): string {
    return getRequiredSecret(env.RELAY_SECRET, "RELAY_SECRET");
}

function createErrorResponse(status: number, message: string): Response {
    return new Response(JSON.stringify({ error: message }), {
        status,
        headers: {
            "content-type": "application/json",
        },
    });
}

function createJsonResponse(status: number, payload: unknown): Response {
    return new Response(JSON.stringify(payload), {
        status,
        headers: {
            "content-type": "application/json",
        },
    });
}

function createHttpError(status: number, message: string): HttpError {
    return { status, message };
}

function isHttpError(value: unknown): value is HttpError {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return false;
    }

    const candidate = value as Record<string, unknown>;
    return Number.isInteger(candidate["status"]) && typeof candidate["message"] === "string";
}

function getClientAddress(request: Request): string {
    const forwardedFor = request.headers.get("cf-connecting-ip");
    if (typeof forwardedFor === "string" && forwardedFor.length > 0) {
        return forwardedFor;
    }

    return "unknown";
}

function parseConnectionPath(pathname: string): { role: RelayRole; companionId: string } | null {
    const parts = pathname.split("/").filter(Boolean);
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

async function readJsonBody(request: Request): Promise<ControlPlaneRequest> {
    try {
        return await request.json<ControlPlaneRequest>();
    } catch {
        return {};
    }
}

function resolvePublicRelayBaseUrl(request: Request, env: Env): string {
    if (typeof env.PUBLIC_RELAY_BASE_URL === "string" && env.PUBLIC_RELAY_BASE_URL.trim().length > 0) {
        return env.PUBLIC_RELAY_BASE_URL.trim().replace(/\/$/, "");
    }

    return new URL(request.url).origin.replace(/\/$/, "");
}

function buildSocketUrl(baseUrl: string, role: RelayRole, companionId: string): string {
    const parsedUrl = new URL(baseUrl);
    parsedUrl.protocol = parsedUrl.protocol === "https:" ? "wss:" : "ws:";
    parsedUrl.pathname = `/connect/${role}/${encodeURIComponent(companionId)}`;
    parsedUrl.search = "";
    parsedUrl.hash = "";
    return parsedUrl.toString();
}

function toCryptoKey(secret: string): Uint8Array {
    return new TextEncoder().encode(secret);
}

async function signToken(
    payload: CompanionRegistrationPayload | RelayAccessPayload,
    secret: string,
    ttlSeconds: number
): Promise<string> {
    return new SignJWT(payload)
        .setProtectedHeader({ alg: "HS256" })
        .setIssuedAt()
        .setExpirationTime(`${ttlSeconds}s`)
        .sign(toCryptoKey(secret));
}

async function verifyToken<TPayload extends { kind: string }>(
    token: string,
    secret: string
): Promise<TPayload> {
    const result = await jwtVerify(token, toCryptoKey(secret), {
        algorithms: ["HS256"],
    });

    return result.payload as TPayload;
}

async function createCompanionRegistrationCredential(
    env: Env,
    hostname: string,
    platform: string
): Promise<{ companionId: string; companionRegistrationCredential: string }> {
    const companionId = crypto.randomUUID();
    const companionRegistrationCredential = await signToken(
        {
            kind: "companion_registration",
            companionId,
            issuedAt: Date.now(),
            hostname,
            platform,
        },
        getControlPlaneSecret(env),
        REGISTRATION_CREDENTIAL_TTL_SECONDS
    );

    return {
        companionId,
        companionRegistrationCredential,
    };
}

async function verifyCompanionRegistrationCredential(
    env: Env,
    credential: string,
    expectedCompanionId?: string
): Promise<CompanionRegistrationPayload> {
    const payload = await verifyToken<CompanionRegistrationPayload>(credential, getControlPlaneSecret(env));
    if (
        payload.kind !== "companion_registration"
        || typeof payload.companionId !== "string"
        || payload.companionId.length === 0
        || typeof payload.hostname !== "string"
        || typeof payload.platform !== "string"
        || typeof payload.issuedAt !== "number"
    ) {
        throw new Error("Companion registration credential payload is invalid.");
    }

    if (typeof expectedCompanionId === "string" && payload.companionId !== expectedCompanionId) {
        throw new Error("Companion registration credential does not match the requested companion.");
    }

    return payload;
}

async function createRelayAccessToken(env: Env, role: RelayRole, companionId: string): Promise<string> {
    return signToken(
        {
            kind: "relay_access",
            role,
            companionId,
            issuedAt: Date.now(),
        },
        getRelaySecret(env),
        role === "companion" ? COMPANION_ACCESS_TOKEN_TTL_SECONDS : MOBILE_ACCESS_TOKEN_TTL_SECONDS
    );
}

async function verifyRelayAccessToken(env: Env, accessToken: string, role: RelayRole, companionId: string): Promise<void> {
    const payload = await verifyToken<RelayAccessPayload>(accessToken, getRelaySecret(env));
    if (
        payload.kind !== "relay_access"
        || payload.role !== role
        || payload.companionId !== companionId
        || typeof payload.issuedAt !== "number"
    ) {
        throw new Error("Relay access token payload is invalid.");
    }
}

async function createSessionPayload(request: Request, env: Env, companionId: string): Promise<SessionPayload> {
    const relayBaseUrl = resolvePublicRelayBaseUrl(request, env);
    const expiresAt = Date.now() + (COMPANION_ACCESS_TOKEN_TTL_SECONDS * 1000);

    return {
        companionId,
        mobileSocketUrl: buildSocketUrl(relayBaseUrl, "mobile", companionId),
        companionSocketUrl: buildSocketUrl(relayBaseUrl, "companion", companionId),
        mobileAccessToken: await createRelayAccessToken(env, "mobile", companionId),
        companionAccessToken: await createRelayAccessToken(env, "companion", companionId),
        expiresAt,
    };
}

async function assertRateLimit(
    env: Env,
    key: string,
    limit: number,
    windowMs: number
): Promise<void> {
    const rateLimiterId = env.RATE_LIMITER.idFromName("global");
    const rateLimiter = env.RATE_LIMITER.get(rateLimiterId);
    const response = await rateLimiter.fetch("https://rate-limit.internal/check", {
        method: "POST",
        headers: {
            "content-type": "application/json",
        },
        body: JSON.stringify({
            key,
            limit,
            windowMs,
        } satisfies RateLimitRequest),
    });

    if (!response.ok) {
        throw createHttpError(503, "Rate limiter request failed.");
    }

    const payload = await response.json<{ allowed?: boolean }>();
    if (payload.allowed !== true) {
        throw createHttpError(429, "Rate limit exceeded.");
    }
}

function parseAttachment(webSocket: WebSocket): WebSocketAttachment {
    const attachment = webSocket.deserializeAttachment();
    if (
        typeof attachment !== "object"
        || attachment === null
        || (attachment.role !== "mobile" && attachment.role !== "companion")
        || typeof attachment.companionId !== "string"
        || typeof attachment.authenticated !== "boolean"
    ) {
        throw new Error("Relay WebSocket attachment is invalid.");
    }

    return attachment;
}

function sendJson(webSocket: WebSocket, payload: unknown): void {
    webSocket.send(JSON.stringify(payload));
}

function findSocketByRole(ctx: DurableObjectState, role: RelayRole): WebSocket | null {
    for (const webSocket of ctx.getWebSockets()) {
        const attachment = parseAttachment(webSocket);
        if (attachment.role === role && attachment.authenticated) {
            return webSocket;
        }
    }

    return null;
}

function isActiveSocket(
    ctx: DurableObjectState,
    webSocket: WebSocket,
    role: RelayRole
): boolean {
    const activeSocket = findSocketByRole(ctx, role);
    return activeSocket === webSocket;
}

function closeSocket(webSocket: WebSocket | null, code: number, reason: string): void {
    if (webSocket === null) {
        return;
    }

    webSocket.close(code, reason);
}

function serializeAttachment(webSocket: WebSocket, attachment: WebSocketAttachment): void {
    webSocket.serializeAttachment(attachment);
}

function parseRelayConnectMessage(rawMessage: string): { role: RelayRole; accessToken: string } | null {
    try {
        const parsed = JSON.parse(rawMessage) as {
            type?: unknown;
            role?: unknown;
            accessToken?: unknown;
        };
        if (
            parsed.type !== "relay.connect"
            || (parsed.role !== "mobile" && parsed.role !== "companion")
            || typeof parsed.accessToken !== "string"
        ) {
            return null;
        }

        return {
            role: parsed.role,
            accessToken: parsed.accessToken,
        };
    } catch {
        return null;
    }
}

function parseCompanionMessage(rawMessage: string): { type: "mobile.message"; data: string } | { type: "mobile.close"; reason?: string } | null {
    try {
        const parsed = JSON.parse(rawMessage) as {
            type?: unknown;
            data?: unknown;
            reason?: unknown;
        };

        if (parsed.type === "mobile.message" && typeof parsed.data === "string") {
            return {
                type: "mobile.message",
                data: parsed.data,
            };
        }

        if (parsed.type === "mobile.close") {
            return {
                type: "mobile.close",
                ...(typeof parsed.reason === "string" ? { reason: parsed.reason } : {}),
            };
        }

        return null;
    } catch {
        return null;
    }
}

export class CompanionRoom extends CloudflareDurableObject<Env> {
    private readonly authTimeouts = new Map<WebSocket, ReturnType<typeof setTimeout>>();

    constructor(ctx: DurableObjectState, env: Env) {
        super(ctx, env);
    }

    async fetch(request: Request): Promise<Response> {
        const upgradeHeader = request.headers.get("Upgrade");
        if (upgradeHeader !== "websocket") {
            return createErrorResponse(426, "Expected a WebSocket upgrade request.");
        }

        const requestUrl = new URL(request.url);
        const role = requestUrl.searchParams.get("role");
        const companionId = requestUrl.searchParams.get("companionId");
        if ((role !== "mobile" && role !== "companion") || typeof companionId !== "string" || companionId.length === 0) {
            return createErrorResponse(400, "Relay room request is invalid.");
        }

        const pair = new WebSocketPair();
        const clientSocket = pair[0];
        const serverSocket = pair[1];

        serializeAttachment(serverSocket, {
            role,
            companionId,
            authenticated: false,
        });
        this.ctx.acceptWebSocket(serverSocket);
        this.scheduleAuthTimeout(serverSocket);

        return new Response(null, {
            status: 101,
            webSocket: clientSocket,
        });
    }

    webSocketMessage(webSocket: WebSocket, rawMessage: string | ArrayBuffer): void {
        const attachment = parseAttachment(webSocket);
        const messageText = typeof rawMessage === "string"
            ? rawMessage
            : new TextDecoder().decode(rawMessage);

        if (!attachment.authenticated) {
            void this.handleAuthMessage(webSocket, attachment, messageText);
            return;
        }

        if (attachment.role === "companion") {
            this.handleCompanionMessage(attachment, messageText);
            return;
        }

        this.handleMobileMessage(attachment, messageText);
    }

    webSocketClose(webSocket: WebSocket): void {
        this.clearAuthTimeout(webSocket);

        const attachment = parseAttachment(webSocket);
        if (!attachment.authenticated) {
            return;
        }

        if (attachment.role === "companion") {
            if (!isActiveSocket(this.ctx, webSocket, "companion")) {
                return;
            }

            const mobileSocket = findSocketByRole(this.ctx, "mobile");
            closeSocket(mobileSocket, 1013, "Companion offline");
            return;
        }

        if (!isActiveSocket(this.ctx, webSocket, "mobile")) {
            return;
        }

        const companionSocket = findSocketByRole(this.ctx, "companion");
        if (companionSocket !== null) {
            sendJson(companionSocket, {
                type: "mobile.close",
                companionId: attachment.companionId,
                reason: "Mobile disconnected",
            });
        }
    }

    webSocketError(webSocket: WebSocket): void {
        this.clearAuthTimeout(webSocket);
    }

    private scheduleAuthTimeout(webSocket: WebSocket): void {
        const timeout = setTimeout(() => {
            webSocket.close(1008, "Relay authentication timeout");
            this.authTimeouts.delete(webSocket);
        }, AUTH_FRAME_TIMEOUT_MS);

        this.authTimeouts.set(webSocket, timeout);
    }

    private clearAuthTimeout(webSocket: WebSocket): void {
        const timeout = this.authTimeouts.get(webSocket);
        if (timeout === undefined) {
            return;
        }

        clearTimeout(timeout);
        this.authTimeouts.delete(webSocket);
    }

    private async handleAuthMessage(
        webSocket: WebSocket,
        attachment: WebSocketAttachment,
        messageText: string
    ): Promise<void> {
        const relayConnectMessage = parseRelayConnectMessage(messageText);
        if (relayConnectMessage === null || relayConnectMessage.role !== attachment.role) {
            webSocket.close(1008, "Relay authentication payload is invalid");
            return;
        }

        try {
            await verifyRelayAccessToken(this.env, relayConnectMessage.accessToken, attachment.role, attachment.companionId);
        } catch {
            webSocket.close(1008, "Relay authentication failed");
            return;
        }

        this.clearAuthTimeout(webSocket);
        const nextAttachment: WebSocketAttachment = {
            ...attachment,
            authenticated: true,
        };
        serializeAttachment(webSocket, nextAttachment);

        if (attachment.role === "companion") {
            const existingCompanion = findSocketByRole(this.ctx, "companion");
            if (existingCompanion !== null && existingCompanion !== webSocket) {
                closeSocket(existingCompanion, 1012, "Replaced by newer companion connection");
            }

            sendJson(webSocket, {
                type: "companion.ready",
                companionId: attachment.companionId,
            });

            const mobileSocket = findSocketByRole(this.ctx, "mobile");
            if (mobileSocket !== null) {
                sendJson(webSocket, {
                    type: "mobile.open",
                    companionId: attachment.companionId,
                });
            }

            return;
        }

        const existingMobile = findSocketByRole(this.ctx, "mobile");
        if (existingMobile !== null && existingMobile !== webSocket) {
            closeSocket(existingMobile, 1012, "Replaced by newer mobile connection");
        }

        const companionSocket = findSocketByRole(this.ctx, "companion");
        if (companionSocket === null) {
            closeSocket(webSocket, 1013, "Companion offline");
            return;
        }

        sendJson(companionSocket, {
            type: "mobile.open",
            companionId: attachment.companionId,
        });
    }

    private handleCompanionMessage(attachment: WebSocketAttachment, messageText: string): void {
        const parsedMessage = parseCompanionMessage(messageText);
        if (parsedMessage === null) {
            return;
        }

        const mobileSocket = findSocketByRole(this.ctx, "mobile");
        if (parsedMessage.type === "mobile.message") {
            if (mobileSocket !== null) {
                mobileSocket.send(parsedMessage.data);
            }
            return;
        }

        closeSocket(mobileSocket, 1000, parsedMessage.reason ?? "Closed by companion");
    }

    private handleMobileMessage(attachment: WebSocketAttachment, messageText: string): void {
        const companionSocket = findSocketByRole(this.ctx, "companion");
        if (companionSocket === null) {
            return;
        }

        sendJson(companionSocket, {
            type: "mobile.message",
            companionId: attachment.companionId,
            data: messageText,
        });
    }
}

export class RateLimiter extends CloudflareDurableObject<Env> {
    constructor(ctx: DurableObjectState, env: Env) {
        super(ctx, env);
    }

    async fetch(request: Request): Promise<Response> {
        if (request.method !== "POST") {
            return createErrorResponse(405, "Method not allowed.");
        }

        const body = await request.json<RateLimitRequest>();
        if (
            typeof body.key !== "string"
            || body.key.length === 0
            || !Number.isInteger(body.limit)
            || body.limit <= 0
            || !Number.isInteger(body.windowMs)
            || body.windowMs <= 0
        ) {
            return createErrorResponse(400, "Rate limit request is invalid.");
        }

        const now = Date.now();
        const existingTimestamps = (await this.ctx.storage.get<number[]>(body.key)) ?? [];
        const recentTimestamps = existingTimestamps.filter((timestamp: number) => now - timestamp < body.windowMs);
        const allowed = recentTimestamps.length < body.limit;
        const nextTimestamps = allowed ? [...recentTimestamps, now] : recentTimestamps;

        await this.ctx.storage.put(body.key, nextTimestamps);
        return createJsonResponse(200, {
            allowed,
            remaining: Math.max(body.limit - nextTimestamps.length, 0),
        });
    }
}

const worker = {
    async fetch(request: Request, env: Env): Promise<Response> {
        try {
            const requestUrl = new URL(request.url);
            const clientAddress = getClientAddress(request);
            const connectionPath = parseConnectionPath(requestUrl.pathname);
            if (connectionPath !== null) {
                await assertRateLimit(
                    env,
                    `connect:${connectionPath.role}:${clientAddress}`,
                    SOCKET_CONNECT_RATE_LIMIT_MAX,
                    SOCKET_CONNECT_WINDOW_MS
                );
                const roomId = env.COMPANION_ROOMS.idFromName(connectionPath.companionId);
                const room = env.COMPANION_ROOMS.get(roomId);
                const roomUrl = new URL("https://relay-room.internal/connect");
                roomUrl.searchParams.set("role", connectionPath.role);
                roomUrl.searchParams.set("companionId", connectionPath.companionId);
                return room.fetch(roomUrl.toString(), request);
            }

            if (request.method === "GET" && requestUrl.pathname === "/health") {
                return createJsonResponse(200, { ok: true });
            }

            if (request.method === "POST" && requestUrl.pathname === "/v1/companions/register") {
                await assertRateLimit(env, `register:${clientAddress}`, REGISTER_RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS);

                const body = await readJsonBody(request);
                const hostname = typeof body.hostname === "string" && body.hostname.length > 0
                    ? body.hostname
                    : "unknown-host";
                const platform = typeof body.platform === "string" && body.platform.length > 0
                    ? body.platform
                    : "unknown-platform";

                const payload = await createCompanionRegistrationCredential(env, hostname, platform);
                return createJsonResponse(200, payload);
            }

            if (request.method === "POST" && requestUrl.pathname === "/v1/companions/session") {
                await assertRateLimit(env, `session:${clientAddress}`, SESSION_RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS);

                const body = await readJsonBody(request);
                if (typeof body.companionRegistrationCredential !== "string") {
                    return createErrorResponse(400, "companionRegistrationCredential is required.");
                }

                const registration = await verifyCompanionRegistrationCredential(
                    env,
                    body.companionRegistrationCredential
                );
                const payload = await createSessionPayload(request, env, registration.companionId);
                return createJsonResponse(200, payload);
            }

            if (request.method === "POST" && requestUrl.pathname === "/v1/companions/session/refresh") {
                await assertRateLimit(env, `refresh:${clientAddress}`, SESSION_RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS);

                const body = await readJsonBody(request);
                if (typeof body.companionRegistrationCredential !== "string") {
                    return createErrorResponse(400, "companionRegistrationCredential is required.");
                }

                const expectedCompanionId = typeof body.companionId === "string" ? body.companionId : undefined;
                const registration = await verifyCompanionRegistrationCredential(
                    env,
                    body.companionRegistrationCredential,
                    expectedCompanionId
                );
                const payload = await createSessionPayload(request, env, registration.companionId);
                return createJsonResponse(200, payload);
            }

            return createErrorResponse(404, "Not found");
        } catch (error) {
            if (isHttpError(error)) {
                return createErrorResponse(error.status, error.message);
            }

            return createErrorResponse(
                500,
                error instanceof Error ? error.message : String(error)
            );
        }
    },
};

export default worker;
