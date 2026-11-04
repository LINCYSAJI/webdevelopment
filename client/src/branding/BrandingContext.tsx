import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Branding } from '@fap/shared';
import { getBranding } from '../api/auth';

const DEFAULT_BRANDING: Branding = {
  organisationName: 'Your Organisation',
  portalName: 'Franchise Agreement Portal',
  logoUrl: null,
  primaryColor: '#1e3a8a',
  secondaryColor: '#0ea5e9',
  supportEmail: null,
  supportPhone: null,
};

/** "#1e3a8a" -> "30 58 138", the format Tailwind's brand colour expects. */
function hexToRgbTriplet(hex: string): string | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}

interface BrandingState extends Branding {
  /** Re-reads branding after Admin saves Settings. */
  reload(): Promise<void>;
}

const BrandingContext = createContext<BrandingState>({ ...DEFAULT_BRANDING, reload: async () => undefined });

export function BrandingProvider({ children }: { children: ReactNode }) {
  const [branding, setBranding] = useState(DEFAULT_BRANDING);

  const reload = useCallback(async () => {
    try {
      setBranding(await getBranding());
    } catch {
      // Keep the current branding if the server is unreachable.
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    const root = document.documentElement.style;
    const primary = hexToRgbTriplet(branding.primaryColor);
    const secondary = hexToRgbTriplet(branding.secondaryColor);
    if (primary) root.setProperty('--brand-primary', primary);
    if (secondary) root.setProperty('--brand-secondary', secondary);
    document.title = branding.portalName;
  }, [branding]);

  return <BrandingContext.Provider value={{ ...branding, reload }}>{children}</BrandingContext.Provider>;
}

export const useBranding = () => useContext(BrandingContext);
