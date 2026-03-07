# Overture Maps Theme Reference

Column choices for the browser's import, popup display, and search — optimized
for **human-friendly map browsing** rather than raw data completeness.

Every Overture parquet file shares a common base that we always import:

| Column | Purpose |
|---|---|
| `id` | Unique feature ID |
| `display_name` | Derived from `names.primary` (or address fields) |
| `geometry` | Native WKB geometry, converted to GeoJSON only at render time |
| `geom_type` | `ST_GeometryType(geometry)` |
| `centroid_lon` / `centroid_lat` | Pre-computed centroid for fast bbox filtering |

Additional per-theme columns (`_f0`, `_f1`, ...) are defined in
`src/lib/constants.js → THEME_FIELDS` and shown in map popups.

---

## places / place

| | |
|---|---|
| **Geometry** | Point |
| **Name / search** | `names.primary` — best FTS target, most features have a name |
| **Size** | Huge (60M+ globally) |

**Default columns (popup)**

| Column | SQL expression | Label |
|---|---|---|
| `categories` | `categories.primary` | Category |
| `confidence` | `ROUND(confidence, 2)` | Confidence |
| `websites` | `websites[1]` | Website |
| `phones` | `phones[1]` | Phone |
| `brand` | `brand.names.primary` | Brand |
| `addresses` | `addresses[1].freeform` | Address |

**Optional / advanced columns** (not imported by default — available in raw parquet):
`categories.alternate`, `socials`, `emails`, `opening_hours`, `brand.wikidata`

---

## buildings / building

| | |
|---|---|
| **Geometry** | Polygon |
| **Name / search** | `names.primary` — many buildings unnamed; FTS still useful for named ones |
| **Size** | Huge (800M+ globally) |

**Default columns**

| Column | SQL | Label |
|---|---|---|
| `subtype` | `subtype` | Subtype |
| `class` | `class` | Class |
| `height` | `ROUND(height, 1)` | Height (m) |
| `num_floors` | `num_floors` | Floors |
| `facade_color` | `facade_color` | Facade color |
| `roof_shape` | `roof_shape` | Roof shape |

**Optional**: `facade_material`, `roof_color`, `roof_material`, `roof_height`,
`roof_direction`, `has_parts`, `level`

---

## buildings / building_part

| | |
|---|---|
| **Geometry** | Polygon |
| **Name / search** | `names.primary` — rarely named; FTS not indexed |
| **Size** | Medium (1-5M) |

**Default columns**

| Column | SQL | Label |
|---|---|---|
| `height` | `ROUND(height, 1)` | Height (m) |
| `num_floors` | `num_floors` | Floors |
| `min_height` | `ROUND(min_height, 1)` | Min height |
| `facade_color` | `facade_color` | Facade color |
| `roof_shape` | `roof_shape` | Roof shape |

**Optional**: `facade_material`, `roof_color`, `roof_material`, `roof_height`, `level`

---

## addresses / address

| | |
|---|---|
| **Geometry** | Point |
| **Name / search** | No `names` struct — display_name falls back to empty string. Search uses street/number via popup fields. FTS indexed on `display_name` (contains address string when available). |
| **Size** | Huge (300M+ globally) |

**Default columns**

| Column | SQL | Label |
|---|---|---|
| `number` | `number` | Number |
| `street` | `street` | Street |
| `postcode` | `postcode` | Postcode |
| `country` | `country` | Country |

**Optional**: `city`, `state`, `address_levels`, `unit`

---

## transportation / segment

| | |
|---|---|
| **Geometry** | LineString |
| **Name / search** | `names.primary` — road/street names; FTS indexed |
| **Size** | Huge (200M+ globally) |

**Default columns**

| Column | SQL | Label |
|---|---|---|
| `subtype` | `subtype` | Subtype |
| `class` | `class` | Class |
| `subclass` | `subclass` | Subclass |
| `road_surface` | `road_surface[1].value` | Surface |
| `speed_limits` | `speed_limits[1].max_speed.value` | Speed limit |

**Optional**: `access_restrictions`, `width`, `lanes`, `level`, `connectors`,
`prohibited_transitions`

---

## transportation / connector

| | |
|---|---|
| **Geometry** | Point |
| **Name / search** | No name column — junctions are anonymous. FTS not indexed. |
| **Size** | Large (100M+) |

**Default columns**: None — connectors are geometry-only junction points linking
segments. Useful for network analysis but minimal popup value.

---

## base / infrastructure

| | |
|---|---|
| **Geometry** | Point, Line, or Polygon |
| **Name / search** | `names.primary` — FTS indexed |
| **Size** | Medium (1-5M) |

**Default columns**

| Column | SQL | Label |
|---|---|---|
| `subtype` | `subtype` | Subtype |
| `class` | `class` | Class |
| `surface` | `surface` | Surface |

Subtypes include: `bridge`, `communication`, `dam`, `fountain`, `pier`,
`power`, `tower`, `utility`, `waste_management`, `water`

---

## base / land

| | |
|---|---|
| **Geometry** | Polygon, Line, or Point |
| **Name / search** | `names.primary` — FTS indexed |
| **Size** | Large (10-50M) |

**Default columns**

| Column | SQL | Label |
|---|---|---|
| `subtype` | `subtype` | Subtype |
| `class` | `class` | Class |
| `elevation` | `elevation` | Elevation |
| `surface` | `surface` | Surface |

Subtypes: `physical`, `glacier`, `reef`, `rock`, `sand`, `forest`, etc.

---

## base / land_cover

| | |
|---|---|
| **Geometry** | Polygon |
| **Name / search** | No name — land cover polygons are unnamed. FTS not indexed. |
| **Size** | Large (10-30M) |

**Default columns**

| Column | SQL | Label |
|---|---|---|
| `subtype` | `subtype` | Subtype |
| `cartography` | `cartography.min_zoom` | Min zoom |
| `cartography` | `cartography.max_zoom` | Max zoom |

Subtypes: `snow`, `crop`, `grass`, `shrub`, `tree`, `urban`, `barren`, `wetland`, `moss`

---

## base / land_use

| | |
|---|---|
| **Geometry** | Polygon |
| **Name / search** | `names.primary` — FTS indexed |
| **Size** | Large (10-30M) |

**Default columns**

| Column | SQL | Label |
|---|---|---|
| `subtype` | `subtype` | Subtype |
| `class` | `class` | Class |
| `surface` | `surface` | Surface |

---

## base / water

| | |
|---|---|
| **Geometry** | Polygon, Line, or Point |
| **Name / search** | `names.primary` — FTS indexed |
| **Size** | Large (10-30M) |

**Default columns**

| Column | SQL | Label |
|---|---|---|
| `subtype` | `subtype` | Subtype |
| `class` | `class` | Class |
| `is_salt` | `is_salt` | Salt |
| `is_intermittent` | `is_intermittent` | Intermittent |

Subtypes: `ocean`, `lake`, `pond`, `reservoir`, `river`, `stream`, `canal`,
`spring`, `waterfall`, etc.

---

## base / bathymetry

| | |
|---|---|
| **Geometry** | Polygon |
| **Name / search** | No name — depth contours are anonymous. FTS not indexed. |
| **Size** | Small (<1M) |

**Default columns**

| Column | SQL | Label |
|---|---|---|
| `depth` | `depth` | Depth |
| `min_depth` | `min_depth` | Min depth |
| `max_depth` | `max_depth` | Max depth |

---

## divisions / division

| | |
|---|---|
| **Geometry** | Point |
| **Name / search** | `names.primary` — country/state/city names; FTS indexed |
| **Size** | Medium (1-5M) |

**Default columns**

| Column | SQL | Label |
|---|---|---|
| `subtype` | `subtype` | Subtype |
| `country` | `country` | Country |
| `region` | `region` | Region |
| `population` | `population` | Population |
| `capital_type` | `capital_type` | Capital |
| `sources` | `regexp_replace(sources[1].record_id, '@.*', '')` | OSM id |

Subtypes: `country`, `dependency`, `macroregion`, `region`, `macrocounty`,
`county`, `localadmin`, `locality`, `borough`, `neighborhood`

---

## divisions / division_area

| | |
|---|---|
| **Geometry** | Polygon / MultiPolygon |
| **Name / search** | `names.primary` — FTS indexed |
| **Size** | Medium (1-5M) |

**Default columns**

| Column | SQL | Label |
|---|---|---|
| `subtype` | `subtype` | Subtype |
| `country` | `country` | Country |
| `region` | `region` | Region |
| `sources` | `regexp_replace(sources[1].record_id, '@.*', '')` | OSM id |

---

## divisions / division_boundary

| | |
|---|---|
| **Geometry** | LineString |
| **Name / search** | No name — boundary lines are anonymous. FTS not indexed. |
| **Size** | Medium (1-5M) |

**Default columns**

| Column | SQL | Label |
|---|---|---|
| `subtype` | `subtype` | Subtype |
| `class` | `class` | Class |

---

## Design notes

### Name resolution

`buildCacheSelect()` in `query.js` resolves `display_name` with this priority:

1. `names.primary` (struct field) — used by most themes
2. `name` (flat column) — fallback for older schemas
3. Empty string — for anonymous features (connectors, land_cover, bathymetry)

### Search / FTS

Only themes with `searchable: true` in `THEME_META` get meaningful FTS results.
The FTS index is built on `display_name` after table creation. Themes with
`searchable: false` (connectors, land_cover, bathymetry, division_boundary) are
still searchable via `ILIKE` fallback but will mostly return empty results since
their features have no name.

### Storage optimization

We import only the columns needed for popup display + basic filtering (centroid,
geometry, display_name, plus THEME_FIELDS). The full Overture schema has many
more columns (sources array, update_time, version, etc.) that are dropped at
import time to save memory in the browser's DuckDB-WASM instance.
