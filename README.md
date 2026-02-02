# Overture Maps Browser

Browser-based viewer for [Overture Maps](https://overturemaps.org/) data using DuckDB-WASM to query Parquet files directly from S3.

![Screenshot](https://github.com/user-attachments/assets/ae3ff9ad-fbf7-4834-86d0-920fa4ddbe65)
![Intersection View](https://github.com/user-attachments/assets/45116629-243c-4c42-a5d4-61e74d9dfa66)

## Features

- Query Overture Maps places and buildings directly in the browser
- No backend required - DuckDB-WASM runs entirely client-side
- Filter places by category with live counts
- Load buildings near places with configurable distance buffer
- Buildings auto-filter when toggling place categories
- File list caching in localStorage for faster subsequent loads
- URL hash preserves map position

## Architecture

- **Frontend**: Static HTML/JS/CSS served by Cloudflare Pages (or nginx locally)
- **Worker**: Cloudflare Worker handles CORS proxy + spatial index for Parquet files
- **Data**: Overture Maps GeoParquet files on S3 (queried directly via HTTP range requests)

## Local Development

```bash
# Terminal 1: Start the Cloudflare Worker
cd worker && npx wrangler dev

# Terminal 2: Start the frontend
docker compose up
```

- Frontend: http://localhost (or http://zarbazan)
- Worker: http://localhost:8787

## Production

Deployed automatically via GitHub Actions:
- Frontend → Cloudflare Pages
- Worker → Cloudflare Workers

Live at: [maps.marchen.co](https://maps.marchen.co)

## Usage

1. Position the map to your area of interest
2. Adjust the limit slider
3. Click "Load Places"
4. Optionally load buildings near places
5. Use category checkboxes to filter places

## How it works

- Cloudflare Worker proxies S3 requests (CORS) and provides spatial file index
- DuckDB-WASM with spatial extension queries Parquet files directly
- Places filtered by bbox, buildings filtered by spatial join with places
- Category filtering is client-side for instant response
