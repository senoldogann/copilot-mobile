// Typed error hierarchy — shared by bridge server and mobile client

export class BridgeError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "BridgeError";
        Object.setPrototypeOf(this, new.target.prototype);
    }
}

export class WebSocketError extends BridgeError {
    readonly closeCode?: number;

    constructor(message: string, closeCode?: number) {
        super(message);
        this.name = "WebSocketError";
        if (closeCode !== undefined) {
            this.closeCode = closeCode;
        }
    }
}

export class AuthError extends BridgeError {
    constructor(message: string) {
        super(message);
        this.name = "AuthError";
    }
}

export class PermissionDeniedError extends BridgeError {
    readonly requestId: string;

    constructor(message: string, requestId: string) {
        super(message);
        this.name = "PermissionDeniedError";
        this.requestId = requestId;
    }
}

export class PermissionTimeoutError extends BridgeError {
    readonly requestId: string;

    constructor(message: string, requestId: string) {
        super(message);
        this.name = "PermissionTimeoutError";
        this.requestId = requestId;
    }
}

export class SDKError extends BridgeError {
    readonly sdkErrorCode?: string;

    constructor(message: string, sdkErrorCode?: string) {
        super(message);
        this.name = "SDKError";
        if (sdkErrorCode !== undefined) {
            this.sdkErrorCode = sdkErrorCode;
        }
    }
}

export class RateLimitError extends BridgeError {
    readonly retryAfterMs: number;

    constructor(message: string, retryAfterMs: number) {
        super(message);
        this.name = "RateLimitError";
        this.retryAfterMs = retryAfterMs;
    }
}

export class ReplayAttackError extends BridgeError {
    readonly messageId: string;

    constructor(message: string, messageId: string) {
        super(message);
        this.name = "ReplayAttackError";
        this.messageId = messageId;
    }
}
