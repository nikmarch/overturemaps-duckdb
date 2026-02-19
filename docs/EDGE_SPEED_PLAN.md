# Edge speed plan (Cloudflare Workers + Overture Maps browser)

This doc captures the plan we discussed in Slack: use Cloudflare Workers to make the **DuckDB-WASM in-browser** experience faster and more reliable **without turning this into a backend database project**.

## Goals

- Faster perceived load time (less "waiting in the dark")
- Fewer remote reads / less request fanout
- Stable production behavior under demos/spikes
- Keep local dev simple (no DO OOM issues)

## Non-goals

- Replacing DuckDB-WASM with a server-side query engine
- Building/operating a persistent database
- Premature complexity (no complicated state machines)

## What Workers are for (in this project)

Workers provide a tiny, high-leverage "edge shim":

1) **Same-origin proxy** to the public dataset (fixes CORS friction)
2) HTTP **Range passthrough** (DuckDB reads Parquet footers via range requests)
3) Cache *metadata endpoints* and *S3 listings*
4) Optional: serve tiny precomputed metadata artifacts (see below)

Workers are **not** here to compute query results.

## Why paying $5/month can be worth it

Paying for Workers won’t magically make Parquet faster. It buys:

- **Headroom** for request volume (demos/spikes won’t hit free-tier ceilings)
- Comfort to cache listings and serve metadata endpoints aggressively
- Less risk of “it works for me but breaks under load”

The actual speed comes from reducing remote work (fanout + bytes).

## Biggest speed win: reduce file fanout

When a theme/type has many Parquet files, the slowest part is often not SQL — it’s the sheer number of HTTP requests.

### Option 1 (local/dev): simplified `/files`

- `/files` returns *all* files for `release/theme/type`
- DuckDB-WASM does bbox filtering locally via SQL
- Pros: simplest, robust locally (no Durable Object memory blowups)
- Cons: more file opens / more metadata reads

### Option 2 (production): indexed `/files` via precomputed artifacts

Bring back “smart file filtering” **without Durable Objects** by using precomputed artifacts:

- Precompute `file -> bbox` for each `{release}/{theme}/{type}`
- Store as a compact JSON (or similar) artifact
- Worker loads that small JSON and returns only intersecting files for a bbox

Pros:
- Massive fanout reduction (best latency win)
- Predictable worker memory usage
- No background index-building, no DO complexity

Cons:
- Requires a build step to generate + publish artifacts

### Deployment model: feature-flagged modes

Keep both modes and switch by environment:

- `INDEX_MODE=none` (dev/local): `/files` lists all files
- `INDEX_MODE=artifact` (prod): `/files` bbox filters using precomputed JSON

This keeps local dev simple and production fast.

## Cache the boring things hard

Cache aggressively at the edge:

- `/releases`
- `/themes?release=...`
- S3 listing calls (`?prefix=...` XML)

These are low-variance and benefit heavily from caching.

## Mirror selection (latency win)

If Overture is available on both AWS and Azure, add an origin selector:

- Auto-select closest origin by region (or let user pick)
- Goal: avoid EU/Asia users pulling from US-West when a closer mirror exists

## Next concrete steps

1) Add `INDEX_MODE` env/config and implement artifact-backed `/files`.
2) Write a small script to generate `file->bbox` artifacts for a release.
3) Store artifacts somewhere cheap and close to Workers (R2 is fine).
4) Update the article to mention the two modes (simple dev vs indexed prod).

## Notes / pitfalls

- Don’t try to “cache query results” at the edge: too many parameter combinations.
- Durable Objects can work for indexing, but local `workerd` memory caps make it fragile for dev.
- Focus on reducing request fanout and distance-to-origin; those are the consistent wins.
