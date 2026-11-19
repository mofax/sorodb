# SoroDB

**An embedded document database for Node.js, built on [SlateDB](https://slatedb.io/).**

Store and query JavaScript documents without running a separate database server.

SoroDB persists data in any s3 compatible object store. xx

## Quickstart

Use **Node.js 22 or later**.

```sh
npm install sorodb
```

Save this as `tasks.mjs`, then run `node tasks.mjs`. No credentials or services are needed.

```js
import SoroDB from "sorodb";

const db = SoroDB({ store: "memory:///", path: "tasks-demo" }).schema({ version: 1 }, [
  {
    table: "tasks",
    columns: {
      id: { type: "number", primary: true },
      title: { type: "string" },
      priority: { type: "number" },
      done: { type: "boolean", default: false },
    },
    indexes: [{ name: "by_priority", columns: [{ field: "priority", direction: "desc" }] }],
  },
]);

try {
  const tasks = await db.collection("tasks");
  await tasks.create({ id: 1, title: "Write release notes", priority: 1 });
  await tasks.create({ id: 2, title: "Fix checkout", priority: 3 });
  await tasks.create({ id: 3, title: "Set up project", priority: 5, done: true });

  const { items } = await tasks
    .filter({
      where: (w) => w.eq("done", false),
      orderBy: (order) => order.desc("priority"),
      select: ["title"],
    })
    .page();

  console.log(items.map((task) => task.title));
  // [ 'Fix checkout', 'Write release notes' ]
} finally {
  await db.close();
}
```

Register the schema before opening a collection or starting a transaction. `db.close()` releases the store and any open query snapshots; the in-memory data is discarded.

## Choose a storage backend

Pass `store` and `path` to `SoroDB()`. For persistent stores, reuse the same `store`, `path`, and schema to reopen the database.

| Backend          | `store`                                                  | `path`                             |
| ---------------- | -------------------------------------------------------- | ---------------------------------- |
| In memory        | `memory:///`                                             | A name for the disposable database |
| Local filesystem | A directory URL from `pathToFileURL(directory).href`     | A database directory within it     |
| Amazon S3        | `s3://your-bucket`                                       | A database prefix in the bucket    |
| Cloudflare R2    | `https://<account-id>.r2.cloudflarestorage.com/<bucket>` | A database prefix in the bucket    |

For S3 or R2, give the application read and write access to the bucket. Add `storeConfig` with `region`, `access_key_id`, and `secret_access_key`; add `token` when using temporary credentials. Use the bucket's region for S3 and `"auto"` for R2. Pass values from your application configuration, or omit `storeConfig` to use SlateDB's environment-based resolution.

Follow the [local persistence tutorial](docs/getting-started.md) to write and reopen data on disk. For object storage, see [SlateDB's S3 guide](https://slatedb.io/docs/tutorials/s3/) or [Cloudflare's R2 setup guide](https://developers.cloudflare.com/r2/get-started/s3/).

To run the [R2 example](examples/basic.js) from a checkout, set the variables listed in [`.env.example`](.env.example) in your own `.env`, then run `node --env-file=.env examples/basic.js`.

## What to know before deploying

- **One writer per database.** SlateDB is [designed for a single writer](https://slatedb.io/docs/get-started/introduction/). Don't open the same persistent database for writes from multiple app instances at once.
- **Sorting needs an index.** Except for ascending `id`, `orderBy` must match the leading fields and directions of a declared index. Filters without a usable index can scan documents.
- **Cursors belong to the open database.** Pages share a snapshot, but a cursor can't be resumed after the database is closed or the cursor expires.
- **Schema upgrades are additive.** Bump the schema version to add collections, fields, or indexes. Removing or changing existing definitions is not supported by the upgrade API.

## Documentation

| I want to…                                                  | Read                                                             |
| ----------------------------------------------------------- | ---------------------------------------------------------------- |
| Look up collection, query, or error APIs                    | [API reference](docs/reference/api.md)                           |
| Define fields, defaults, filters, and projections           | [Schema and query reference](docs/reference/schema-and-query.md) |
| Sort results or enforce uniqueness                          | [Indexes and sorting](docs/guides/indexes-and-sorting.md)        |
| Commit or roll back writes across collections together      | [Transactions](docs/guides/transactions.md)                      |
| Stream results or resume a page                             | [Pagination](docs/guides/pagination.md)                          |
| Add fields and backfill existing documents                  | [Schema upgrades](docs/guides/schema-upgrades.md)                |
| Understand how documents, indexes, and snapshots are stored | [Architecture](docs/explanation/architecture.md)                 |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for checkout setup and development checks. Report bugs or request features in [GitHub Issues](https://github.com/mofax/sorodb/issues).

## License

[MIT](LICENSE)
