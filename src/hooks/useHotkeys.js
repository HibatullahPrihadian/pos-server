import { useEffect, useRef } from 'react';

// Daftarkan hotkey global (mis. F2, F4, Escape) dengan penanganan default dicegah.
// map: { F2: fn, F4: fn, Escape: fn }
const useHotkeys = (map, { enabled = true } = {}) => {
  const mapRef = useRef(map);
  mapRef.current = map;

  useEffect(() => {
    if (!enabled) return undefined;

    const handler = (event) => {
      const fn = mapRef.current[event.key];
      if (typeof fn === 'function') {
        event.preventDefault();
        fn(event);
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [enabled]);
};

export default useHotkeys;
