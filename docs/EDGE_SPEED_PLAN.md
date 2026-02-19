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

### POC mode (single-user): lazy edge-built `file -> bbox` index, cached for days

Given constraints:

- *No KV*
- *No Durable Objects*
- *No R2 mirroring (keep blobs on Overture S3)*
- OK with slow first load

We can still get “smart filtering” by lazily building a `file -> bbox` index **on first use** and caching it at the edge using the **Cache API**.

Flow:

1) UI calls `GET /releases` to populate a dropdown (cached 1 day)
2) UI calls `GET /files/:type?release=...&bbox=...`
3) If the index is missing, Worker returns `202` quickly and starts building the index in the background (`ctx.waitUntil`)
4) UI shows “Building index…” and polls until it gets `200`
5) Once cached, requests are fast for days

Notes:

- No locking: worst case we build the same index twice on a cold cache. For “just me”, that’s acceptable.
- This is a POC-friendly way to keep dev == prod (same Worker code path).

### Alternative modes (later)

If this ever needs to be public/reliable, we switch to a real artifact pipeline:

- Generate index artifacts in CI, store in R2, serve instantly
- Or add DO/KV to coordinate builds + persist indices

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
