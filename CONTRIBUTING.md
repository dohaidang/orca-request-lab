# Contributing

Contributions that keep Request Lab focused, local-first, and dependency-free are welcome.

## Development setup

1. Use Node.js 22 or newer.
2. Clone the repository.
3. Run `npm run verify` for repository checks and browser-side unit tests.
4. Run `orca plugin check .` and `orca plugin test .` with Orca 1.4.255 or newer for the complete plugin test suite.
5. Add the repository under **Settings → Plugins → Development** for manual testing.

## Pull requests

- Keep each change focused and include tests for parsing or data transformations.
- Preserve the dependency-free browser interface unless a dependency has a clear security and maintenance benefit.
- Never commit credentials, access tokens, private endpoints, or exported workspace files containing real environment values.
- Update `README.md` and `CHANGELOG.md` when behavior changes.
- Confirm keyboard focus, narrow layouts, both Orca color schemes, and reduced-motion behavior for UI changes.

## Commit style

Use short imperative subjects, for example:

```text
Add request-level redirect controls
Fix cookie expiry handling
```
