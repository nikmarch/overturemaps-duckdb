import { describe, it, expect, beforeEach } from 'vitest';
import {
  useStore,
  addLoadedTable,
  addPipelineNode,
  removePipelineNode,
  updatePipelineNode,
  clearPipeline,
} from '../store.js';

function resetStore() {
  useStore.setState({
    pipeline: [],
    loadedTables: [],
    pipelineSearch: '',
    pipelineLimit: 3000,
    compiledSql: '',
    sqlOverride: null,
    pipelineResult: null,
    pipelineRunning: false,
    pipelineBbox: null,
  });
}

describe('store pipeline helpers', () => {
  beforeEach(resetStore);

  describe('addLoadedTable', () => {
    it('adds table and creates source node for first table', () => {
      addLoadedTable('places_place', 'places/place');
      const s = useStore.getState();
      expect(s.loadedTables).toEqual(['places_place']);
      expect(s.pipeline).toHaveLength(1);
      expect(s.pipeline[0].type).toBe('source');
      expect(s.pipeline[0].table).toBe('places_place');
      expect(s.pipeline[0].key).toBe('places/place');
      expect(s.pipeline[0].op).toBeUndefined();
    });

    it('adds union node for subsequent tables', () => {
      addLoadedTable('places_place', 'places/place');
      addLoadedTable('buildings_building', 'buildings/building');
      const s = useStore.getState();
      expect(s.loadedTables).toHaveLength(2);
      expect(s.pipeline).toHaveLength(2);
      expect(s.pipeline[1].type).toBe('combine');
      expect(s.pipeline[1].op).toBe('union');
    });

    it('deduplicates tables', () => {
      addLoadedTable('places_place', 'places/place');
      addLoadedTable('places_place', 'places/place');
      const s = useStore.getState();
      expect(s.loadedTables).toHaveLength(1);
      expect(s.pipeline).toHaveLength(1);
    });
  });

  describe('addPipelineNode', () => {
    it('adds a node and clears sqlOverride', () => {
      useStore.setState({ sqlOverride: 'SELECT 1' });
      addPipelineNode({ type: 'combine', op: 'union', table: 'x', key: 'x/y' });
      const s = useStore.getState();
      expect(s.pipeline).toHaveLength(1);
      expect(s.sqlOverride).toBeNull();
    });

    it('generates an id if not provided', () => {
      addPipelineNode({ type: 'source', table: 'x', key: 'x/y' });
      expect(useStore.getState().pipeline[0].id).toBeTruthy();
    });
  });

  describe('removePipelineNode', () => {
    it('removes the node', () => {
      addLoadedTable('places_place', 'places/place');
      addLoadedTable('buildings_building', 'buildings/building');
      const id = useStore.getState().pipeline[1].id;
      removePipelineNode(id);
      expect(useStore.getState().pipeline).toHaveLength(1);
    });

    it('promotes first remaining node to source when source is removed', () => {
      addLoadedTable('places_place', 'places/place');
      addLoadedTable('buildings_building', 'buildings/building');
      const sourceId = useStore.getState().pipeline[0].id;
      removePipelineNode(sourceId);
      const p = useStore.getState().pipeline;
      expect(p).toHaveLength(1);
      expect(p[0].type).toBe('source');
      expect(p[0].op).toBeUndefined();
    });
  });

  describe('updatePipelineNode', () => {
    it('patches the node and clears sqlOverride', () => {
      addLoadedTable('places_place', 'places/place');
      addLoadedTable('buildings_building', 'buildings/building');
      useStore.setState({ sqlOverride: 'SELECT 1' });
      const id = useStore.getState().pipeline[1].id;
      updatePipelineNode(id, { op: 'intersect' });
      const s = useStore.getState();
      expect(s.pipeline[1].op).toBe('intersect');
      expect(s.sqlOverride).toBeNull();
    });
  });

  describe('clearPipeline', () => {
    it('resets pipeline state', () => {
      addLoadedTable('places_place', 'places/place');
      useStore.setState({ sqlOverride: 'SELECT 1', pipelineResult: { count: 5 } });
      clearPipeline();
      const s = useStore.getState();
      expect(s.pipeline).toEqual([]);
      expect(s.sqlOverride).toBeNull();
      expect(s.pipelineResult).toBeNull();
    });
  });
});
