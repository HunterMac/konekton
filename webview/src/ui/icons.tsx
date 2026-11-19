import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

const base: IconProps = { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' };

export const StickyIcon = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M2.5 2.5h11v7l-4 4h-7z" />
    <path d="M9.5 13.5v-4h4" />
  </svg>
);

export const RectangleIcon = (p: IconProps) => (
  <svg {...base} {...p}>
    <rect x="2" y="3.5" width="12" height="9" rx="1" />
  </svg>
);

export const GridIcon = (p: IconProps) => (
  <svg {...base} {...p}>
    <rect x="2" y="2" width="12" height="12" />
    <path d="M6 2v12M10 2v12M2 6h12M2 10h12" />
  </svg>
);

export const AlignIcon = ({ align, ...p }: IconProps & { align: 'left' | 'center' | 'right' }) => {
  const lines: [number, number][] = [
    [2, 14],
    [align === 'left' ? 2 : align === 'center' ? 4 : 6, align === 'left' ? 10 : align === 'center' ? 12 : 14],
    [2, 14],
    [align === 'left' ? 2 : align === 'center' ? 5 : 8, align === 'left' ? 8 : align === 'center' ? 11 : 14],
  ];
  return (
    <svg {...base} {...p}>
      {lines.map(([x1, x2], i) => (
        <path key={i} d={`M${x1} ${3.5 + i * 3}H${x2}`} />
      ))}
    </svg>
  );
};

export const ArrowEndIcon = ({ at, on, ...p }: IconProps & { at: 'start' | 'end'; on: boolean }) => (
  <svg {...base} {...p} opacity={on ? 1 : 0.55}>
    {at === 'end' ? (
      <>
        <path d="M2 8h11" />
        <path d="M9.5 4.5L13 8l-3.5 3.5" />
      </>
    ) : (
      <>
        <path d="M3 8h11" />
        <path d="M6.5 4.5L3 8l3.5 3.5" />
      </>
    )}
  </svg>
);

export const LabelIcon = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M2 4h12M5 8h6M7 12h2" />
  </svg>
);

export const ResizeIcon = (p: IconProps) => (
  <svg width={14} height={14} viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" {...p}>
    <path d="M13 5L5 13M13 9l-4 4" />
  </svg>
);

/** Two chevrons, `>>`: a task in progress. */
export const ProgressIcon = (p: IconProps) => (
  <svg {...base} strokeWidth={2} style={{ stroke: '#fff', flex: 'none' }} {...p}>
    <path d="M3.5 4L7.5 8l-4 4M8.5 4l4 4-4 4" />
  </svg>
);

export const Codicon = ({ name, className = '' }: { name: string; className?: string }) => <span className={`codicon codicon-${name} ${className}`} aria-hidden="true" />;
