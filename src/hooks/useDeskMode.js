import { useEffect, useState } from 'react';

// Cocokkan dengan screen `desk` di tailwind.config.js. Sinkron dengan CSS:
// mode desktop = lebar >=1280 DAN pointer presisi (mouse/trackpad).
const QUERY = '(min-width: 1280px) and (pointer: fine)';

// useDeskMode mengembalikan true bila viewport saat ini memakai layout desktop.
// Berguna untuk mensinkronkan state JS (drawer mobile, sidebar collapse) dengan
// breakpoint CSS yang tidak bisa dibaca langsung dari kelas Tailwind.
const useDeskMode = () => {
  const [isDesk, setIsDesk] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(QUERY).matches
  );

  useEffect(() => {
    const mql = window.matchMedia(QUERY);
    const onChange = (e) => setIsDesk(e.matches);
    mql.addEventListener('change', onChange);
    setIsDesk(mql.matches);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return isDesk;
};

export default useDeskMode;
