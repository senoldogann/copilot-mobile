import { appendFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import type { SessionMessageAttachment } from "@copilot-mobile/shared";

const ATTACHMENT_UPLOAD_TTL_MS = 60 * 60 * 1000;
const ATTACHMENT_UPLOAD_DIR = join(tmpdir(), "copilot-mobile-attachment-uploads");
const ATTACHMENT_UPLOAD_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

type PendingAttachmentUpload = {
    deviceId: string;
    mimeType: string;
    displayName?: string;
    filePath: string;
    createdAt: number;
    completed: boolean;
    writeChain: Promise<void>;
};

async function safeDeleteFile(filePath: string): Promise<void> {
    await rm(filePath, { force: true }).catch(() => {});
}

function assertValidUploadId(uploadId: string): void {
    if (!ATTACHMENT_UPLOAD_ID_PATTERN.test(uploadId)) {
        throw new Error("Invalid uploadId");
    }
}

function createUploadFilePath(uploadId: string): string {
    assertValidUploadId(uploadId);
    const attachmentUploadDir = resolve(ATTACHMENT_UPLOAD_DIR);
    const filePath = resolve(attachmentUploadDir, `${uploadId}-${randomUUID()}.b64`);
    if (filePath !== attachmentUploadDir && !filePath.startsWith(`${attachmentUploadDir}${sep}`)) {
        throw new Error("Invalid upload file path");
    }
    return filePath;
}

export function createAttachmentUploadStore() {
    const uploads = new Map<string, PendingAttachmentUpload>();

    async function cleanupExpiredUploads(): Promise<void> {
        const now = Date.now();
        for (const [uploadId, upload] of uploads) {
            if (now - upload.createdAt < ATTACHMENT_UPLOAD_TTL_MS) {
                continue;
            }

            uploads.delete(uploadId);
            await safeDeleteFile(upload.filePath);
        }
    }

    async function requireUpload(deviceId: string, uploadId: string): Promise<PendingAttachmentUpload> {
        await cleanupExpiredUploads();
        const upload = uploads.get(uploadId);
        if (upload === undefined) {
            throw new Error(`Upload ${uploadId} not found`);
        }

        if (upload.deviceId !== deviceId) {
            throw new Error(`Upload ${uploadId} does not belong to this device`);
        }

        return upload;
    }

    return {
        async startUpload(
            deviceId: string,
            uploadId: string,
            input: {
                mimeType: string;
                displayName?: string;
            }
        ): Promise<void> {
            await cleanupExpiredUploads();
            if (uploads.has(uploadId)) {
                throw new Error(`Upload ${uploadId} already exists`);
            }

            await mkdir(ATTACHMENT_UPLOAD_DIR, { recursive: true });
            const filePath = createUploadFilePath(uploadId);
            const writeChain = writeFile(filePath, "", "utf8");
            uploads.set(uploadId, {
                deviceId,
                mimeType: input.mimeType,
                ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
                filePath,
                createdAt: Date.now(),
                completed: false,
                writeChain,
            });
            await writeChain;
        },

        async appendChunk(
            deviceId: string,
            uploadId: string,
            data: string
        ): Promise<void> {
            const upload = await requireUpload(deviceId, uploadId);
            if (upload.completed) {
                throw new Error(`Upload ${uploadId} is already completed`);
            }

            upload.writeChain = upload.writeChain.then(() => appendFile(upload.filePath, data, "utf8"));
            await upload.writeChain;
        },

        async completeUpload(deviceId: string, uploadId: string): Promise<void> {
            const upload = await requireUpload(deviceId, uploadId);
            await upload.writeChain;
            upload.completed = true;
        },

        async resolveAttachments(
            deviceId: string,
            attachments: ReadonlyArray<SessionMessageAttachment> | undefined
        ): Promise<ReadonlyArray<SessionMessageAttachment> | undefined> {
            if (attachments === undefined || attachments.length === 0) {
                return undefined;
            }

            await cleanupExpiredUploads();
            const resolved: Array<SessionMessageAttachment> = [];
            const consumedUploads: Array<PendingAttachmentUpload> = [];

            for (const attachment of attachments) {
                if (attachment.type === "blob") {
                    resolved.push(attachment);
                    continue;
                }

                const upload = await requireUpload(deviceId, attachment.uploadId);
                await upload.writeChain;
                if (!upload.completed) {
                    throw new Error(`Upload ${attachment.uploadId} is incomplete`);
                }

                const data = await readFile(upload.filePath, "utf8");
                resolved.push({
                    type: "blob",
                    data,
                    mimeType: upload.mimeType,
                    ...(upload.displayName !== undefined ? { displayName: upload.displayName } : {}),
                });
                uploads.delete(attachment.uploadId);
                consumedUploads.push(upload);
            }

            await Promise.all(consumedUploads.map((upload) => safeDeleteFile(upload.filePath)));
            return resolved;
        },
    };
}
