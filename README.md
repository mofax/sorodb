# SoroDB

SoroDB is an embedded document database for Node.js, built on SlateDB. Define a schema, store JavaScript documents, and query them with indexes, transactions, and snapshot-backed pagination.

SoroDB is an ECMAScript module and requires Node.js 20 or later.

## Quick start

```js
import SoroDB from "sorodb";

const db = SoroDB({ store: "memory:///", path: "quick-start" });
db.schema({ version: 1 }, [
  {
    table: "users",
    columns: {
      id: { type: "number", primary: true },
      name: { type: "string" },
    },
  },
]);

try {
  const users = await db.collection("users");
  await users.create({ id: 1, name: "Ada" });
  const page = await users.filter({ where: (w) => w.eq("name", "Ada") }).page();
  console.log(page.items); // [{ id: 1, name: "Ada" }]
} finally {
  await db.close();
}
```

Register the schema before the first collection or transaction call. Always close the database to release the underlying store and any active query snapshots.

## Store data in Amazon S3

Create a bucket and give the application read and write access to it. Pass its region and credentials explicitly through `storeConfig`; SoroDB forwards these provider-specific keys to SlateDB's `ObjectStoreBuilder`. Credentials can come from any source without setting process-wide `AWS_*` environment variables. For temporary credentials, also pass `token`. The [S3 object-store configuration](https://docs.rs/object_store/latest/object_store/aws/enum.AmazonS3ConfigKey.html) lists supported keys. Omitting `storeConfig` retains SlateDB's environment-based resolution.

Replace `your-bucket-name` with your bucket. The `store` URL selects the bucket; `path` places this database under the `sorodb-demo` prefix in that bucket.

```js
import SoroDB from "sorodb";

const db = SoroDB({
  store: "s3://your-bucket-name",
  path: "sorodb-demo",
  storeConfig: {
    region: "your-bucket-region",
    access_key_id: process.env.SORODB_ACCESS_KEY_ID,
    secret_access_key: process.env.SORODB_SECRET_ACCESS_KEY,
  },
});
db.schema({ version: 1 }, [
  {
    table: "users",
    columns: {
      id: { type: "number", primary: true },
      name: { type: "string" },
    },
  },
]);

try {
  const users = await db.collection("users");
  if (!(await users.get(1))) await users.create({ id: 1, name: "Ada" });
  console.log(await users.get(1)); // { id: 1, name: "Ada" }
} finally {
  await db.close();
}
```

Run the program again with the same bucket, path, and schema to read the stored document. See the [SlateDB object-store guide](https://slatedb.io/docs/get-started/quickstart/) for supported store URLs.

## Store data in Cloudflare R2

This Node.js example uses R2's S3-compatible API. Create an R2 bucket and an API token with **Object Read & Write** access to that bucket. Pass its credentials explicitly with `region: "auto"`. See [Cloudflare's R2 S3 guide](https://developers.cloudflare.com/r2/get-started/s3/) for the bucket, token, and account ID setup.

Replace `your-account-id` and `your-bucket-name` below. The `store` URL selects the R2 endpoint and bucket; `path` places the database under the `sorodb-demo` prefix in the bucket.

```js
import SoroDB from "sorodb";

const db = SoroDB({
  store: "https://your-account-id.r2.cloudflarestorage.com/your-bucket-name",
  path: "sorodb-demo",
  storeConfig: {
    region: "auto",
    access_key_id: process.env.SORODB_ACCESS_KEY_ID,
    secret_access_key: process.env.SORODB_SECRET_ACCESS_KEY,
  },
});
db.schema({ version: 1 }, [
  {
    table: "users",
    columns: {
      id: { type: "number", primary: true },
      name: { type: "string" },
    },
  },
]);

try {
  const users = await db.collection("users");
  if (!(await users.get(1))) await users.create({ id: 1, name: "Ada" });
  console.log(await users.get(1)); // { id: 1, name: "Ada" }
} finally {
  await db.close();
}
```

Run the program again with the same endpoint, bucket, path, and schema to read the stored document. For a bucket in a specific R2 jurisdiction, use its [jurisdiction-specific endpoint](https://developers.cloudflare.com/r2/api/tokens/).

## Documentation

- [Getting started](docs/getting-started.md): build a file-backed database and reopen it.
- [API reference](docs/reference/api.md): database, collection, query, and error APIs.
- [Schema and query reference](docs/reference/schema-and-query.md): types, indexes, filters, and ordering.
- Guides: [schema upgrades](docs/guides/schema-upgrades.md), [indexes and sorting](docs/guides/indexes-and-sorting.md), [transactions](docs/guides/transactions.md), and [pagination](docs/guides/pagination.md).
- [Architecture](docs/explanation/architecture.md): how documents, indexes, and snapshots fit together.
- [Contributing](CONTRIBUTING.md): setup and checks for repository changes.

## Run this repository

```sh
bun install --frozen-lockfile
cp -n .env.example .env # Keeps an existing .env; otherwise fill in R2 credentials.
node --env-file=.env examples/basic.js
bun run test
bun run typecheck
bun run build:types
```

Run the [basic example](examples/basic.js) with Node's `--env-file=.env` option to load its database-specific `SORODB_*` variables. It passes credentials explicitly through `storeConfig`, without relying on global `AWS_*` variables, and demonstrates a descending index and async iteration. `.env` is git-ignored. Each run queries existing users and adds two new demo users.

## License

SoroDB is licensed under the [MIT License](LICENSE).
