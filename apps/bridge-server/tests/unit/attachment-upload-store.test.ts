import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createAttachmentUploadStore } from "../../src/uploads/attachment-upload-store.js";

describe("attachment upload store", () => {
    it("resolves completed upload refs into blob attachments", async () => {
        const store = createAttachmentUploadStore();

        await store.startUpload("device-1", "upload-1", {
            mimeType: "image/jpeg",
            displayName: "photo.jpg",
        });
        await store.appendChunk("device-1", "upload-1", "abc");
        await store.appendChunk("device-1", "upload-1", "def");
        await store.completeUpload("device-1", "upload-1");

        const resolved = await store.resolveAttachments("device-1", [
            {
                type: "upload_ref",
                uploadId: "upload-1",
                mimeType: "image/jpeg",
                displayName: "photo.jpg",
            },
        ]);

        assert.deepEqual(resolved, [
            {
                type: "blob",
                data: "abcdef",
                mimeType: "image/jpeg",
                displayName: "photo.jpg",
            },
        ]);
    });

    it("rejects upload ids with path traversal characters", async () => {
        const store = createAttachmentUploadStore();

        await assert.rejects(
            () => store.startUpload("device-1", "../../etc/passwd", {
                mimeType: "image/jpeg",
            }),
            /Invalid uploadId/
        );
    });
});
