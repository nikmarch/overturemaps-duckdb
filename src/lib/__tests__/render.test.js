import { describe, it, expect, vi } from 'vitest';

// Mock leaflet and other browser-dependent modules before importing render.js
vi.mock('leaflet', () => ({ default: {} }));
vi.mock('../map.js', () => ({ getMap: () => null }));
vi.mock('../intersections.js', () => ({
  intersectionInfoByPointId: new Map(),
  isIntersectionMode: () => false,
}));

const { clamp, darkenHex } = await import('../render.js');

describe('clamp', () => {
  it('returns value when within range', () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });

  it('clamps to lo when below', () => {
    expect(clamp(-3, 0, 10)).toBe(0);
  });

  it('clamps to hi when above', () => {
    expect(clamp(15, 0, 10)).toBe(10);
  });

  it('handles edge values', () => {
    expect(clamp(0, 0, 10)).toBe(0);
    expect(clamp(10, 0, 10)).toBe(10);
  });
});

describe('darkenHex', () => {
  it('darkens white by default amount', () => {
    const result = darkenHex('#ffffff');
    // 255 * 0.78 = 198.9 → 199 → c7
    expect(result).toBe('#c7c7c7');
  });

  it('returns black when amount is 1', () => {
    expect(darkenHex('#ffffff', 1)).toBe('#000000');
  });

  it('returns same color when amount is 0', () => {
    expect(darkenHex('#ff8040', 0)).toBe('#ff8040');
  });

  it('handles hex without hash', () => {
    const result = darkenHex('ffffff', 0.5);
    expect(result).toBe('#808080');
  });
});
