export function getUserLocation(geolocation = globalThis.navigator?.geolocation) {
  if (!geolocation) {
    return Promise.reject(new Error('Browser location is not available'));
  }

  return new Promise((resolve, reject) => {
    geolocation.getCurrentPosition(
      position => {
        resolve({
          lat: position.coords.latitude,
          lon: position.coords.longitude,
          accuracy: position.coords.accuracy,
        });
      },
      error => {
        reject(new Error(locationErrorMessage(error)));
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  });
}

export function locationErrorMessage(error) {
  if (error?.code === 1) return 'Location permission denied';
  if (error?.code === 2) return 'Location unavailable';
  if (error?.code === 3) return 'Location request timed out';
  return 'Could not get current location';
}
