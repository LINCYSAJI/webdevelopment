import { useBranding } from '../branding/BrandingContext';

/** Organisation logo, or its initials until a logo is supplied. */
export function BrandMark({ size = 40 }: { size?: number }) {
  const { logoUrl, organisationName } = useBranding();
  if (logoUrl) {
    return <img src={logoUrl} alt={organisationName} style={{ height: size }} className="w-auto" />;
  }
  const initials = organisationName
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return (
    <div
      className="flex items-center justify-center rounded-md bg-brand font-bold text-white"
      style={{ height: size, width: size, fontSize: size * 0.4 }}
      aria-hidden
    >
      {initials}
    </div>
  );
}
