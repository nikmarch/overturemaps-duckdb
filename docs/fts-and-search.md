# DuckDB FTS & Global Search Filter

Practical notes from implementing full-text search (FTS) and the “global search” SQL filter in this repo.

## 1) Extension loading (best-effort)

DuckDB-WASM builds vary. FTS may not be available, so loading must never break the app.

We do best-effort:

```sql
INSTALL fts;
LOAD fts;
```

Both can fail depending on the build; in that case we fall back to a plain `ILIKE` filter.

## 2) Index creation

We index `display_name` (which we derive during cache/import):

```sql
PRAGMA create_fts_index('places_place', 'id', 'display_name');
```

This creates helper objects for the table. We treat it as “FTS available” per-table only if those helper tables exist.

## 3) Querying: `match` vs `match_bm25`

Important gotcha we hit in the browser worker build:

- `fts_main_<table>.match('q')` is **not available**
- DuckDB suggests `match_bm25` instead

So our correct predicate is:

```sql
WHERE fts_main_places_place.match_bm25(id, 'cost')
```

(We pass the document id column as the first arg.)

## 4) Fallback when FTS is missing

If FTS can’t be loaded or the index doesn’t exist for that table, we fall back to:

```sql
WHERE display_name ILIKE '%q%'
```

## 5) Global search is a *SQL filter* (not a results list)

The “search” input is implemented as a **global SQL filter** that affects:

- map rendering (all loaded theme tables)
- snapview tables / snapview map overlay

So when a search term is active, you see **only matching features**, everywhere.

## 6) Failure modes we hit (and fixed)

### Dangling `AND` → parser error near `LIMIT`

We had a bug where the injected search clause became a dangling `AND`, producing SQL like:

```sql
... WHERE <bbox stuff>
  AND
LIMIT 10000
```

DuckDB then errors “syntax error at or near LIMIT”.

Fix: only inject `AND (<clause>)` when we have a real clause.

### Wrong FTS predicate (`match`)

DuckDB in this build errors:

> Scalar Function with name match does not exist! Did you mean "match_bm25"?

Fix: use `match_bm25(id, 'query')`.

## 7) Why unit tests were green while runtime broke

Our unit tests cover *string builders* and store helpers. They’re fast and deterministic, but they don’t execute DuckDB parsing/execution.

That’s why:

- a composition bug (dangling `AND`) passed unit tests
- a runtime-only compatibility issue (`match` vs `match_bm25`) passed unit tests

Takeaway: we need a DuckDB-executed integration layer.

## 8) Integration test harness (current state)

We added an optional integration test harness (see PR #21) to run DuckDB-WASM under Vitest/node.

Caveat discovered:

- The **node-blocking** DuckDB-WASM target does not behave identically to the **browser worker** target for FTS in our environment.
- After `create_fts_index`, `match_bm25` returns NULLs in node-blocking, even though it works in the browser worker.

### Next step: “VCR-style” real fixtures

The robust approach is to record a tiny real-data fixture:

- pick a tiny viewport and one release
- download/cache a small set of parquet files
- commit those fixtures (a few MB) and run integration tests against them

That’s what will actually catch the same class of failures we hit here.
