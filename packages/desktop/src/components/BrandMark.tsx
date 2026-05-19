type BrandMarkProps = {
  size?: 'sm' | 'md' | 'lg';
};

export function BrandMark({ size = 'md' }: BrandMarkProps) {
  return (
    <span className={`brand-mark brand-mark-${size}`} aria-hidden="true">
      <svg viewBox="0 0 64 64" role="img" focusable="false">
        <path className="brand-mark-frame" d="M12 10h40l6 8v28l-10 8H16L6 46V18l6-8Z" />
        <path className="brand-mark-v" d="M17 19l15 28 15-28" />
        <path className="brand-mark-core" d="M32 22l10 6v12l-10 6-10-6V28l10-6Z" />
        <path className="brand-mark-core-line" d="M24 29l8 5 8-5M32 34v10" />
      </svg>
    </span>
  );
}
