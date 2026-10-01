import { useState, useEffect, useCallback } from 'react';
import { api } from '../api/client';

// Hook fetch ringkas untuk GET: mengembalikan { data, loading, error, reload }.
// Halaman yang butuh mutasi/filter kompleks memakai `api` langsung.
const useApi = (path, params, { skip = false } = {}) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(!skip);
  const [error, setError] = useState(null);

  const paramsKey = JSON.stringify(params || {});

  const load = useCallback(async () => {
    if (!path || skip) return;
    setLoading(true);
    setError(null);
    try {
      const result = await api.get(path, JSON.parse(paramsKey));
      setData(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [path, paramsKey, skip]);

  useEffect(() => {
    load();
  }, [load]);

  return { data, setData, loading, error, reload: load };
};

export default useApi;
