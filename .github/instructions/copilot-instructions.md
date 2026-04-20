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