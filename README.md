# Overture Maps Browser

Browser-based viewer for [Overture Maps](https://overturemaps.org/) data using DuckDB-WASM to query Parquet files directly from S3.

![Screenshot](https://share.cleanshot.com/PmZyWsJr)

## Features

- Query Overture Maps places and buildings directly in the browser
- No backend required - DuckDB-WASM runs entirely client-side
- Filter places by category with live counts
- Load buildings near places with configurable distance buffer
- Buildings auto-filter when toggling place categories
- File list caching in localStorage for faster subsequent loads
- URL hash preserves map position

## Development

```bash
docker compose up
```

- App: http://localhost
- S3 proxy: http://localhost:8080

## Production Build

```bash
docker compose run --rm app npm run build
```

Output in `dist/` - serve with any static file server.

1. Position the map to your area of interest
2. Adjust the limit slider
3. Check "Load buildings near places" if needed
4. Click "Load Data"
5. Use category checkboxes to filter places and buildings

## How it works

- Uses nginx to proxy S3 requests (avoiding CORS issues)
- DuckDB-WASM with spatial extension queries Parquet files directly
- Places filtered by bbox, buildings filtered by bbox overlap with places
- Category filtering is client-side for instant response
