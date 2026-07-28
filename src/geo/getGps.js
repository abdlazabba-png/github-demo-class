// Best-effort GPS tag for a capture. Must never block or fail capture:
// unavailable API, denied permission, or a timeout all resolve to null
// rather than rejecting, since GPS is metadata, not a requirement — the
// PWA has to "work fully offline for capture" per CLAUDE.md regardless of
// whether a location fix is available.
export function getGps({ timeoutMs = 5000 } = {}) {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      resolve(null);
      return;
    }
    const timer = setTimeout(() => resolve(null), timeoutMs);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        clearTimeout(timer);
        resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        });
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60000 }
    );
  });
}
