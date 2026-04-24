import type { SessionMessageAttachment } from "@copilot-mobile/shared";
import type { ImageAttachment } from "../components/chat-input-types";

export const MAX_MESSAGE_IMAGE_ATTACHMENTS = 5;
export const ATTACHMENT_UPLOAD_CHUNK_BASE64_CHARS = 180_000;
export const LEGACY_BRIDGE_ATTACHMENT_BASE64_CHAR_LIMIT = 700_000;

export function splitAttachmentBase64(base64Data: string): ReadonlyArray<string> {
    const chunks: Array<string> = [];
    for (let offset = 0; offset < base64Data.length; offset += ATTACHMENT_UPLOAD_CHUNK_BASE64_CHARS) {
        chunks.push(base64Data.slice(offset, offset + ATTACHMENT_UPLOAD_CHUNK_BASE64_CHARS));
    }
    return chunks;
}

export function createPendingUploadAttachments(
    images: ReadonlyArray<ImageAttachment>
): ReadonlyArray<SessionMessageAttachment> | undefined {
    if (images.length === 0) {
        return undefined;
    }

    return images.map((image, index) => ({
        type: "upload_ref",
        uploadId: `local:${index}:${image.fileName}:${image.uri}`,
        mimeType: image.mimeType,
        displayName: image.fileName,
    }));
}

export function createBlobAttachments(
    images: ReadonlyArray<ImageAttachment>
): ReadonlyArray<SessionMessageAttachment> | undefined {
    if (images.length === 0) {
        return undefined;
    }

    return images.map((image) => ({
        type: "blob",
        data: image.base64Data,
        mimeType: image.mimeType,
        displayName: image.fileName,
    }));
}

export function getTotalAttachmentBase64Chars(images: ReadonlyArray<ImageAttachment>): number {
    return images.reduce((sum, image) => sum + image.base64Data.length, 0);
}
