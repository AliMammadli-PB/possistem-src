import type { ReactNode } from 'react';
import { asset } from '@/lib/assets';

type ThemePictureProps = {
  baseName: 'setup' | 'offline' | 'journey' | 'downloads';
  alt: string;
  width: number;
  height: number;
  className?: string;
  loading?: 'lazy' | 'eager';
  decoding?: 'async' | 'sync' | 'auto';
  children?: ReactNode;
};

/** Light/dark editorial pair switched by html[data-theme]. No browser chrome. */
export function ThemePicture({
  baseName,
  alt,
  width,
  height,
  className,
  loading = 'lazy',
  decoding = 'async',
  children,
}: ThemePictureProps) {
  const lightSrc = asset(`/assets/editorial/v2-home-${baseName}-light.webp`);
  const darkSrc = asset(`/assets/editorial/v2-home-${baseName}-dark.webp`);
  const wrapClass = ['theme-picture', className].filter(Boolean).join(' ');

  return (
    <span className={wrapClass}>
      <img
        className="theme-picture__img theme-picture__light"
        src={lightSrc}
        alt={alt}
        width={width}
        height={height}
        loading={loading}
        decoding={decoding}
      />
      <img
        className="theme-picture__img theme-picture__dark"
        src={darkSrc}
        alt=""
        width={width}
        height={height}
        loading={loading}
        decoding={decoding}
        aria-hidden="true"
      />
      {children}
    </span>
  );
}
