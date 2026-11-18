# Contributing to SoroDB

## Set up a checkout

Use Node.js 20 or later, Bun for the committed `bun.lock`, and npm for the package preview command.

```sh
bun install --frozen-lockfile
cp -n .env.example .env # Keeps an existing .env; otherwise fill in R2 credentials.
node --env-file=.env examples/basic.js
bun run test
bun run typecheck
bun run build:types
```

The example uses an R2 bucket configured in the git-ignored `.env` file, loaded by Node's `--env-file` option. It writes demo users and can be rerun against the same database. Tests use memory stores or create and remove temporary filesystem directories; they do not need R2 credentials.

## Make a change

The package is ESM JavaScript with JSDoc types checked by TypeScript. `npm run build:types` generates publishable declarations in `types/`; npm also runs it automatically before packing or publishing. Public imports come from `src/index.js`; add public APIs there deliberately. Use `src/types.js` for shared JSDoc definitions. See the [architecture map](docs/explanation/architecture.md) for module responsibilities.

Add a behavioral test in `test/sorodb.test.js` for changes to validation, persistence, indexes, query results, transactions, or cursor behavior. Update the [API reference](docs/reference/api.md) and relevant guide when public behavior changes. Keep runnable examples aligned with the documented API.

Before opening a pull request, run:

```sh
bun run test
bun run typecheck
bun run lint
bun run fmt --check
bun run pack:dry
```

The package preview should include `src`, `types`, `LICENSE`, `README.md`, `CONTRIBUTING.md`, `docs`, and `examples`. Summarize the behavior changed, the checks you ran, and any compatibility or migration impact in the pull request.
