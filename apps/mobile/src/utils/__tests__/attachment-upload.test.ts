import {
    ATTACHMENT_UPLOAD_CHUNK_BASE64_CHARS,
    createPendingUploadAttachments,
    MAX_MESSAGE_IMAGE_ATTACHMENTS,
    splitAttachmentBase64,
} from "../attachment-upload";

describe("attachment upload helpers", () => {
    it("splits base64 payloads into bounded chunks", () => {
        const data = "a".repeat(ATTACHMENT_UPLOAD_CHUNK_BASE64_CHARS * 2 + 17);
        expect(splitAttachmentBase64(data)).toEqual([
            "a".repeat(ATTACHMENT_UPLOAD_CHUNK_BASE64_CHARS),
            "a".repeat(ATTACHMENT_UPLOAD_CHUNK_BASE64_CHARS),
            "a".repeat(17),
        ]);
    });

    it("creates stable local pending upload refs", () => {
        expect(createPendingUploadAttachments([
            {
                uri: "file:///tmp/one.jpg",
                width: 100,
                height: 50,
                fileName: "one.jpg",
                mimeType: "image/jpeg",
                base64Data: "abc",
            },
        ])).toEqual([
            {
                type: "upload_ref",
                uploadId: "local:0:one.jpg:file:///tmp/one.jpg",
                mimeType: "image/jpeg",
                displayName: "one.jpg",
            },
        ]);
    });

    it("keeps the message image cap at five", () => {
        expect(MAX_MESSAGE_IMAGE_ATTACHMENTS).toBe(5);
    });
});
