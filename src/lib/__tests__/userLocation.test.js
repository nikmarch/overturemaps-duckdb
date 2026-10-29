import { describe, it, expect, vi } from 'vitest';
import { getUserLocation, locationErrorMessage } from '../userLocation.js';

describe('getUserLocation', () => {
  it('resolves browser coordinates', async () => {
    const getCurrentPosition = vi.fn(success => success({
      coords: { latitude: 61.5814, longitude: -149.4394, accuracy: 25 },
    }));

    await expect(getUserLocation({ getCurrentPosition })).resolves.toEqual({
      lat: 61.5814,
      lon: -149.4394,
      accuracy: 25,
    });
    expect(getCurrentPosition).toHaveBeenCalledWith(
      expect.any(Function),
      expect.any(Function),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  });

  it('rejects when browser location is unavailable', async () => {
    await expect(getUserLocation(null)).rejects.toThrow('Browser location is not available');
  });

  it('uses readable permission errors', async () => {
    const getCurrentPosition = vi.fn((_success, failure) => failure({ code: 1 }));
    await expect(getUserLocation({ getCurrentPosition })).rejects.toThrow('Location permission denied');
  });
});

describe('locationErrorMessage', () => {
  it('maps geolocation error codes', () => {
    expect(locationErrorMessage({ code: 1 })).toBe('Location permission denied');
    expect(locationErrorMessage({ code: 2 })).toBe('Location unavailable');
    expect(locationErrorMessage({ code: 3 })).toBe('Location request timed out');
    expect(locationErrorMessage({ code: 999 })).toBe('Could not get current location');
  });
});
