# Shared server code

## `domain/` — pure TypeScript, imported twice

`domain/` is the only code in the repo that both `saoi-api` and the browser compile. It holds the
requirement engine, the state machine, reuse policy, advisories and metrics.

Two rules make the double import work, and both are enforced:

1. **Relative imports inside `domain/` carry an explicit `.ts` extension.** `saoi-api`'s bundler
   and Vite both tolerate it.
2. **The only third-party import is bare `zod`.** It is pinned to the same major
   version in the app and in `services/api`, so the two agree on the schema types.

No Node APIs and no browser APIs belong in `domain/` — ESLint's `no-restricted-globals` fails the
build if one appears. The app reaches this folder through the `@domain` alias; `saoi-api`
reaches it through the `@shared` alias.

## The other folders

| Folder          | Holds                                                                                                     |
| --------------- | --------------------------------------------------------------------------------------------------------- |
| `contracts/`    | Zod request/response schemas. Types are inferred, never hand-written.                                     |
| `llm/`          | Gate, prompt composer, persona, refusals, tool definitions.                                               |
| `tenants/demo/` | Product catalogue, domain config, brand strings. Injected, never imported by `domain/` or `src/saoirse/`. |
