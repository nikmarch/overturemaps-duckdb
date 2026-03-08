export const PROXY = '/api';

export const DEFAULT_VIEW = [34.05, -118.25];
export const DEFAULT_ZOOM = 14;

export const THEME_COLORS = {
  places:         { fill: '#e74c3c', stroke: '#c0392b' },
  buildings:      { fill: '#3388ff', stroke: '#2266cc' },
  transportation: { fill: '#f39c12', stroke: '#d68910' },
  base:           { fill: '#27ae60', stroke: '#1e8449' },
  addresses:      { fill: '#8e44ad', stroke: '#6c3483' },
  divisions:      { fill: '#2c3e50', stroke: '#1a252f' },
};

export const PALETTE_16 = [
  '#4E79A7', '#F28E2B', '#E15759', '#76B7B2',
  '#59A14F', '#EDC948', '#B07AA1', '#FF9DA7',
  '#9C755F', '#BAB0AC', '#1F77B4', '#FF7F0E',
  '#2CA02C', '#D62728', '#9467BD', '#8C564B',
];

export const DEFAULT_COLOR = { fill: '#95a5a6', stroke: '#7f8c8d' };

export const THEME_FIELDS = {
  'places/place': [
    { col: 'categories', sql: 'categories.primary', label: 'Category' },
    { col: 'confidence', sql: 'ROUND(confidence, 2)', label: 'Confidence' },
    { col: 'websites', sql: 'websites[1]', label: 'Website' },
    { col: 'phones', sql: 'phones[1]', label: 'Phone' },
    { col: 'brand', sql: 'brand.names.primary', label: 'Brand' },
    { col: 'addresses', sql: 'addresses[1].freeform', label: 'Address' },
  ],
  'buildings/building': [
    { col: 'subtype', sql: 'subtype', label: 'Subtype' },
    { col: 'class', sql: 'class', label: 'Class' },
    { col: 'height', sql: 'ROUND(height, 1)', label: 'Height (m)' },
    { col: 'num_floors', sql: 'num_floors', label: 'Floors' },
    { col: 'facade_color', sql: 'facade_color', label: 'Facade color' },
    { col: 'roof_shape', sql: 'roof_shape', label: 'Roof shape' },
  ],
  'buildings/building_part': [
    { col: 'height', sql: 'ROUND(height, 1)', label: 'Height (m)' },
    { col: 'num_floors', sql: 'num_floors', label: 'Floors' },
    { col: 'min_height', sql: 'ROUND(min_height, 1)', label: 'Min height' },
    { col: 'facade_color', sql: 'facade_color', label: 'Facade color' },
    { col: 'roof_shape', sql: 'roof_shape', label: 'Roof shape' },
  ],
  'addresses/address': [
    { col: 'number', sql: 'number', label: 'Number' },
    { col: 'street', sql: 'street', label: 'Street' },
    { col: 'postcode', sql: 'postcode', label: 'Postcode' },
    { col: 'country', sql: 'country', label: 'Country' },
  ],
  'transportation/segment': [
    { col: 'subtype', sql: 'subtype', label: 'Subtype' },
    { col: 'class', sql: 'class', label: 'Class' },
    { col: 'subclass', sql: 'subclass', label: 'Subclass' },
    { col: 'road_surface', sql: 'road_surface[1].value', label: 'Surface' },
    { col: 'speed_limits', sql: 'speed_limits[1].max_speed.value', label: 'Speed limit' },
  ],
  'transportation/connector': [],
  'base/infrastructure': [
    { col: 'subtype', sql: 'subtype', label: 'Subtype' },
    { col: 'class', sql: 'class', label: 'Class' },
    { col: 'surface', sql: 'surface', label: 'Surface' },
  ],
  'base/land': [
    { col: 'subtype', sql: 'subtype', label: 'Subtype' },
    { col: 'class', sql: 'class', label: 'Class' },
    { col: 'elevation', sql: 'elevation', label: 'Elevation' },
    { col: 'surface', sql: 'surface', label: 'Surface' },
  ],
  'base/land_cover': [
    { col: 'subtype', sql: 'subtype', label: 'Subtype' },
    { col: 'cartography', sql: 'cartography.min_zoom', label: 'Min zoom' },
    { col: 'cartography', sql: 'cartography.max_zoom', label: 'Max zoom' },
  ],
  'base/land_use': [
    { col: 'subtype', sql: 'subtype', label: 'Subtype' },
    { col: 'class', sql: 'class', label: 'Class' },
    { col: 'surface', sql: 'surface', label: 'Surface' },
  ],
  'base/water': [
    { col: 'subtype', sql: 'subtype', label: 'Subtype' },
    { col: 'class', sql: 'class', label: 'Class' },
    { col: 'is_salt', sql: 'is_salt', label: 'Salt' },
    { col: 'is_intermittent', sql: 'is_intermittent', label: 'Intermittent' },
  ],
  'base/bathymetry': [
    { col: 'depth', sql: 'depth', label: 'Depth' },
    { col: 'min_depth', sql: 'min_depth', label: 'Min depth' },
    { col: 'max_depth', sql: 'max_depth', label: 'Max depth' },
  ],
  'divisions/division': [
    { col: 'subtype', sql: 'subtype', label: 'Subtype' },
    { col: 'country', sql: 'country', label: 'Country' },
    { col: 'region', sql: 'region', label: 'Region' },
    { col: 'population', sql: 'population', label: 'Population' },
    { col: 'capital_type', sql: 'capital_type', label: 'Capital' },
    { col: 'sources', sql: "regexp_replace(sources[1].record_id, '@.*', '')", label: 'OSM id' },
  ],
  'divisions/division_area': [
    { col: 'subtype', sql: 'subtype', label: 'Subtype' },
    { col: 'country', sql: 'country', label: 'Country' },
    { col: 'region', sql: 'region', label: 'Region' },
    { col: 'sources', sql: "regexp_replace(sources[1].record_id, '@.*', '')", label: 'OSM id' },
  ],
  'divisions/division_boundary': [
    { col: 'subtype', sql: 'subtype', label: 'Subtype' },
    { col: 'class', sql: 'class', label: 'Class' },
  ],
};

// Theme metadata – geometry expectations, name handling, search config,
// and human-readable notes for each Overture Maps type.
//
// `geometry`    – expected geometry type(s)
// `nameCol`     – how display_name is derived ('names.primary' | 'address' | null)
// `searchable`  – whether FTS indexing is worthwhile (false for unnamed geom-only types)
// `size`        – rough global row-count tier: 'huge' (100M+), 'large' (10-100M),
//                 'medium' (1-10M), 'small' (<1M)
// `description` – short human-friendly summary
export const THEME_META = {
  'places/place': {
    geometry: 'Point',
    nameCol: 'names.primary',
    searchable: true,
    size: 'huge',
    description: 'Points of interest – restaurants, shops, landmarks, etc.',
  },
  'buildings/building': {
    geometry: 'Polygon',
    nameCol: 'names.primary',
    searchable: true,
    size: 'huge',
    description: 'Building footprints with optional height/floor data.',
  },
  'buildings/building_part': {
    geometry: 'Polygon',
    nameCol: 'names.primary',
    searchable: false,
    size: 'medium',
    description: '3-D sub-parts of buildings (wings, towers, etc.).',
  },
  'addresses/address': {
    geometry: 'Point',
    nameCol: 'address',
    searchable: true,
    size: 'huge',
    description: 'Geocoded address points with street/number/postcode.',
  },
  'transportation/segment': {
    geometry: 'LineString',
    nameCol: 'names.primary',
    searchable: true,
    size: 'huge',
    description: 'Road, path, and rail segments with classification.',
  },
  'transportation/connector': {
    geometry: 'Point',
    nameCol: null,
    searchable: false,
    size: 'large',
    description: 'Junction points linking transportation segments.',
  },
  'base/infrastructure': {
    geometry: 'Point | Line | Polygon',
    nameCol: 'names.primary',
    searchable: true,
    size: 'medium',
    description: 'Human-made structures – bridges, dams, piers, towers.',
  },
  'base/land': {
    geometry: 'Polygon | Line | Point',
    nameCol: 'names.primary',
    searchable: true,
    size: 'large',
    description: 'Natural land features – mountains, cliffs, glaciers.',
  },
  'base/land_cover': {
    geometry: 'Polygon',
    nameCol: null,
    searchable: false,
    size: 'large',
    description: 'Land cover polygons – forest, grassland, bare rock.',
  },
  'base/land_use': {
    geometry: 'Polygon',
    nameCol: 'names.primary',
    searchable: true,
    size: 'large',
    description: 'Human land use zones – residential, commercial, industrial.',
  },
  'base/water': {
    geometry: 'Polygon | Line | Point',
    nameCol: 'names.primary',
    searchable: true,
    size: 'large',
    description: 'Water bodies and waterways – lakes, rivers, oceans.',
  },
  'base/bathymetry': {
    geometry: 'Polygon',
    nameCol: null,
    searchable: false,
    size: 'small',
    description: 'Ocean/sea depth contour polygons.',
  },
  'divisions/division': {
    geometry: 'Point',
    nameCol: 'names.primary',
    searchable: true,
    size: 'medium',
    description: 'Administrative division points (countries, states, cities).',
  },
  'divisions/division_area': {
    geometry: 'Polygon | MultiPolygon',
    nameCol: 'names.primary',
    searchable: true,
    size: 'medium',
    description: 'Administrative boundary areas.',
  },
  'divisions/division_boundary': {
    geometry: 'LineString',
    nameCol: null,
    searchable: false,
    size: 'medium',
    description: 'Administrative boundary lines between divisions.',
  },
};
