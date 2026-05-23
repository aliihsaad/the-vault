type BrandMarkProps = {
  size?: 'sm' | 'md' | 'lg';
};

export function BrandMark({ size = 'md' }: BrandMarkProps) {
  return (
    <span className={`brand-mark brand-mark-${size}`} aria-hidden="true">
      <img
        src="./sidebar-logo-128.png"
        srcSet="./sidebar-logo-64.png 64w, ./sidebar-logo-128.png 128w, ./sidebar-logo-256.png 256w"
        sizes={size === 'sm' ? '28px' : size === 'lg' ? '48px' : '44px'}
        alt=""
        draggable={false}
      />
    </span>
  );
}
