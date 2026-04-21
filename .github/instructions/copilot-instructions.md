---
description: Load these instructions for all repository tasks involving code generation, code review, refactoring, debugging, dependency changes, testing, and technical explanations.
applyTo: "**/*"
---

# Personal AGENTS.md

Follow repository-specific `AGENTS.md` files first. When there is no conflict, apply the following defaults.

## Code Style

- Write comments in English only.
- Prefer functional programming over OOP.
- Use OOP classes only for connectors and interfaces to external systems.
- Write pure functions whenever possible.
- Never mutate input parameters.
- Do not rely on global mutable state.
- Follow DRY, KISS, and YAGNI principles.
- Use strict typing everywhere, including function parameters, return values, variables, and collections.
- Avoid untyped variables and overly generic types.
- Create explicit type definitions for complex data structures.
- Never use default parameter values. Make all parameters explicit.
- Check whether similar logic already exists before introducing new code.
- Keep imports at the top of the file.
- Write simple, single-purpose functions.
- Do not introduce multi-mode functions.
- Do not use boolean flag parameters to switch behavior.

## Error Handling

- Raise errors explicitly. Never fail silently.
- Use specific error types that clearly describe the failure.
- Do not use catch-all exception handlers that hide root causes.
- Error messages must be clear and actionable.
- Do not add fallbacks unless explicitly requested.
- Fix root causes instead of masking symptoms.
- For external API or service calls, use retries with warnings, then raise the final error.
- Include enough debugging context in errors, such as request parameters, response body, and status codes where relevant.
- Use structured logging fields instead of interpolating dynamic values directly into log message strings.

## Tooling and Dependencies

- Prefer modern project package management files such as `pyproject.toml` and `package.json`.
- Install dependencies in the project environment, not globally.
- Add dependencies to project configuration files instead of relying on one-off manual installs.
- Read installed dependency source code when needed instead of guessing behavior.

## Testing

- Respect the repository’s existing testing strategy and current test suite.
- Do not add new unit tests by default.
- When tests are needed, prefer integration, end-to-end, or smoke tests that validate real behavior.
- Use unit tests only when they are clearly the best fit, such as for stable datasets or pure data transformations.
- Do not add unit tests just to increase coverage numbers.
- Avoid mocks when real calls are practical.
- Prefer real API or service calls over fragile mock-heavy coverage when practical.
- Add only the minimum test coverage needed for the requested change.

## Workflow

- Inspect the repository before making edits.
- Read all active `AGENTS.md` files before making assumptions.
- Keep changes minimal and directly related to the current task.
- Match the repository’s existing style, even when it differs from these personal preferences.
- Do not revert unrelated changes.
- Prefer `rg` for code search.
- Use non-interactive commands with flags.
- Always use non-interactive diff commands such as `git --no-pager diff` or `git diff | cat`.
- Run relevant tests, checks, or validation commands after making code changes when the project already defines them.

## Documentation

- Treat code as the primary documentation.
- Prefer clear naming, strong types, and docstrings over separate explanatory files.
- Keep documentation in the docstrings of the functions or classes they describe.
- Create separate documentation files only when a concept cannot be expressed clearly in code.
- Do not duplicate documentation across files.
- Store documentation as the current state, not as a changelog of modifications.

## Additional Reference

Also follow the guidance in:

`@/Users/dogan/.codex/RTK.md`

# context-mode — MANDATORY routing rules

You have context-mode MCP tools available. These rules are NOT optional — they protect your context window from flooding. A single unrouted command can dump 56 KB into context and waste the entire session.

## Think in Code — MANDATORY

When you need to analyze, count, filter, compare, search, parse, transform, or process data: **write code** that does the work via `ctx_execute(language, code)` and `console.log()` only the answer. Do NOT read raw data into context to process mentally. Your role is to PROGRAM the analysis, not to COMPUTE it. Write robust, pure JavaScript — no npm dependencies, only Node.js built-ins (`fs`, `path`, `child_process`). Always use `try/catch`, handle `null`/`undefined`, and ensure compatibility with both Node.js and Bun. One script replaces ten tool calls and saves 100x context.

## BLOCKED commands — do NOT attempt these

### curl / wget — BLOCKED
Any terminal command containing `curl` or `wget` will be intercepted and blocked. Do NOT retry.
Instead use:
- `ctx_fetch_and_index(url, source)` to fetch and index web pages
- `ctx_execute(language: "javascript", code: "const r = await fetch(...)")` to run HTTP calls in sandbox

### Inline HTTP — BLOCKED
Any terminal command containing `fetch('http`, `requests.get(`, `requests.post(`, `http.get(`, or `http.request(` will be intercepted and blocked. Do NOT retry with terminal.
Instead use:
- `ctx_execute(language, code)` to run HTTP calls in sandbox — only stdout enters context

### WebFetch / fetch — BLOCKED
Direct web fetching tools are blocked. Use the sandbox equivalent.
Instead use:
- `ctx_fetch_and_index(url, source)` then `ctx_search(queries)` to query the indexed content

## REDIRECTED tools — use sandbox equivalents

### Terminal / run_in_terminal (>20 lines output)
Terminal is ONLY for: `git`, `mkdir`, `rm`, `mv`, `cd`, `ls`, `npm install`, `pip install`, and other short-output commands.
For everything else, use:
- `ctx_batch_execute(commands, queries)` — run multiple commands + search in ONE call
- `ctx_execute(language: "shell", code: "...")` — run in sandbox, only stdout enters context

### read_file (for analysis)
If you are reading a file to **edit** it → read_file is correct (edit needs content in context).
If you are reading to **analyze, explore, or summarize** → use `ctx_execute_file(path, language, code)` instead. Only your printed summary enters context.

### grep / search (large results)
Search results can flood context. Use `ctx_execute(language: "shell", code: "grep ...")` to run searches in sandbox. Only your printed summary enters context.

## Tool selection hierarchy

1. **GATHER**: `ctx_batch_execute(commands, queries)` — Primary tool. Runs all commands, auto-indexes output, returns search results. ONE call replaces 30+ individual calls. Each command: `{label: "descriptive header", command: "..."}`. Label becomes FTS5 chunk title — descriptive labels improve search.
2. **FOLLOW-UP**: `ctx_search(queries: ["q1", "q2", ...])` — Query indexed content. Pass ALL questions as array in ONE call.
3. **PROCESSING**: `ctx_execute(language, code)` | `ctx_execute_file(path, language, code)` — Sandbox execution. Only stdout enters context.
4. **WEB**: `ctx_fetch_and_index(url, source)` then `ctx_search(queries)` — Fetch, chunk, index, query. Raw HTML never enters context.
5. **INDEX**: `ctx_index(content, source)` — Store content in FTS5 knowledge base for later search.

## Output constraints

- Keep responses under 500 words.
- Write artifacts (code, configs, PRDs) to FILES — never return them as inline text. Return only: file path + 1-line description.
- When indexing content, use descriptive source labels so others can `ctx_search(source: "label")` later.

## ctx commands

| Command | Action |
|---------|--------|
| `ctx stats` | Call the `ctx_stats` MCP tool and display the full output verbatim |
| `ctx doctor` | Call the `ctx_doctor` MCP tool, run the returned shell command, display as checklist |
| `ctx upgrade` | Call the `ctx_upgrade` MCP tool, run the returned shell command, display as checklist |
| `ctx purge` | Call the `ctx_purge` MCP tool with confirm: true. Warns before wiping the knowledge base. |

After /clear or /compact: knowledge base and session stats are preserved. Use `ctx purge` if you want to start fresh.