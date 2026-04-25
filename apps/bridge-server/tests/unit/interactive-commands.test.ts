import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseInteractiveCommandsFromBundle } from "../../src/copilot/interactive-commands.js";

describe("interactive command parsing", () => {
    it("extracts command names and help text from the CLI bundle", () => {
        const bundle = `
            var Foo,Bar,Baz,Qux,Quux,cmds=N(()=>{"use strict";Foo="/context",Bar="/usage",Baz="/restart",Qux="/help",Quux="/statusline"});
            var contextDef={name:Foo,help:"Show context window token usage and visualization"};
            var usageDef={name:Bar,help:"Display session usage metrics and statistics"};
            var restartDef={name:Baz,help:"Restart the CLI, preserving the current session"};
        `;

        assert.deepEqual(parseInteractiveCommandsFromBundle(bundle), [
            {
                name: "/context",
                description: "Show context window token usage and visualization",
            },
            {
                name: "/help",
                description: "",
            },
            {
                name: "/restart",
                description: "Restart the CLI, preserving the current session",
            },
            {
                name: "/statusline",
                description: "",
            },
            {
                name: "/usage",
                description: "Display session usage metrics and statistics",
            },
        ]);
    });
});
