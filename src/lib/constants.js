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
  ],
  'buildings/building': [
    { col: 'subtype', sql: 'subtype', label: 'Subtype' },
    { col: 'class', sql: 'class', label: 'Class' },
    { col: 'height', sql: 'ROUND(height, 1)', label: 'Height' },
    { col: 'num_floors', sql: 'num_floors', label: 'Floors' },
  ],
  'buildings/building_part': [
    { col: 'height', sql: 'ROUND(height, 1)', label: 'Height' },
    { col: 'num_floors', sql: 'num_floors', label: 'Floors' },
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
  ],
  'base/infrastructure': [
    { col: 'subtype', sql: 'subtype', label: 'Subtype' },
    { col: 'class', sql: 'class', label: 'Class' },
  ],
  'base/land': [
    { col: 'subtype', sql: 'subtype', label: 'Subtype' },
    { col: 'class', sql: 'class', label: 'Class' },
    { col: 'elevation', sql: 'elevation', label: 'Elevation' },
  ],
  'base/land_cover': [
    { col: 'subtype', sql: 'subtype', label: 'Subtype' },
  ],
  'base/land_use': [
    { col: 'subtype', sql: 'subtype', label: 'Subtype' },
    { col: 'class', sql: 'class', label: 'Class' },
  ],
  'base/water': [
    { col: 'subtype', sql: 'subtype', label: 'Subtype' },
    { col: 'class', sql: 'class', label: 'Class' },
    { col: 'is_salt', sql: 'is_salt', label: 'Salt' },
    { col: 'is_intermittent', sql: 'is_intermittent', label: 'Intermittent' },
  ],
  'base/bathymetry': [
    { col: 'depth', sql: 'depth', label: 'Depth' },
  ],
  'divisions/division': [
    { col: 'subtype', sql: 'subtype', label: 'Subtype' },
    { col: 'country', sql: 'country', label: 'Country' },
    { col: 'population', sql: 'population', label: 'Population' },
    { col: 'sources', sql: 'sources[1].record_id', label: 'OSM record' },
    { col: 'sources', sql: "regexp_replace(sources[1].record_id, '@.*', '')", label: 'OSM relation id' },
  ],
  'divisions/division_area': [
    { col: 'subtype', sql: 'subtype', label: 'Subtype' },
    { col: 'country', sql: 'country', label: 'Country' },
    { col: 'sources', sql: 'sources[1].record_id', label: 'OSM record' },
    { col: 'sources', sql: "regexp_replace(sources[1].record_id, '@.*', '')", label: 'OSM relation id' },
  ],
  'divisions/division_boundary': [
    { col: 'subtype', sql: 'subtype', label: 'Subtype' },
    { col: 'class', sql: 'class', label: 'Class' },
  ],
};
