# Overture Maps Browser

Browser-based viewer for [Overture Maps](https://overturemaps.org/) data using DuckDB-WASM to query Parquet files directly from S3.

## Features

- Browse any Overture Maps release - releases discovered dynamically from S3
- Load any theme/type (places, buildings, transportation, etc.) onto the map
- Per-theme row limit controls
- Spatial file index filters parquet files by viewport bounding box
- DuckDB-WASM runs entirely client-side - no backend database
- URL hash preserves map position

## Architecture

- **Frontend**: Static HTML/JS/CSS served by nginx
- **Worker**: Cloudflare Worker (wrangler dev locally) handles S3 proxy, release/theme discovery, and spatial index via Durable Objects
- **Data**: Overture Maps GeoParquet files on S3, queried via HTTP range requests

## Local Development

```bash
docker compose up
```

Open http://localhost:8123

## Usage

1. Select a release from the dropdown
2. Check a theme to load its data for the current viewport
3. Adjust per-theme limits as needed
4. Pan/zoom the map and re-check themes to load new areas
