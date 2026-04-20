// Message ID generator and timestamp

import { randomUUID } from "node:crypto";

let seqCounter = 0;

export function generateMessageId(): string {
    return randomUUID();
}

export function nextSeq(): number {
    seqCounter += 1;
    return seqCounter;
}

export function resetSeq(): void {
    seqCounter = 0;
}

export function nowMs(): number {
    return Date.now();
}
