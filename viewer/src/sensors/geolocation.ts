export interface GeoPosition {
  latitudeDeg: number;
  longitudeDeg: number;
}

export function isGeolocationSupported(): boolean {
  return "geolocation" in navigator;
}

export function requestGeoPosition(): Promise<GeoPosition> {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          latitudeDeg: position.coords.latitude,
          longitudeDeg: position.coords.longitude,
        });
      },
      (err) => reject(err),
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 60000 },
    );
  });
}
