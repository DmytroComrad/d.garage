import type { ReactNode } from "react";

const Svg = ({ children, size = 20 }: { children: ReactNode; size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
);

type P = { size?: number };

export const WrenchIcon = ({ size }: P) => (
  <Svg size={size}>
    <path d="M14.7 6.3a4 4 0 0 0-5.2 5.2l-5.8 5.8a1.8 1.8 0 0 0 2.5 2.5l5.8-5.8a4 4 0 0 0 5.2-5.2l-2.6 2.6-2.5-.5-.5-2.5z" />
  </Svg>
);

export const PumpIcon = ({ size }: P) => (
  <Svg size={size}>
    <path d="M4 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16" />
    <path d="M3 21h12" />
    <path d="M7 8h4" />
    <path d="M14 12h1.5a1.5 1.5 0 0 1 1.5 1.5V17a1.5 1.5 0 0 0 3 0V8.5L17 5.5" />
  </Svg>
);

/** Контрольна лампа: нагадування виглядає як сигнал на панелі приладів. */
export const LampIcon = ({ size }: P) => (
  <Svg size={size}>
    <path d="M9 18h6" />
    <path d="M10 21h4" />
    <path d="M12 3a6 6 0 0 0-3.6 10.8c.6.5 1 1.2 1.1 2.2h5c.1-1 .5-1.7 1.1-2.2A6 6 0 0 0 12 3z" />
  </Svg>
);

export const PersonIcon = ({ size }: P) => (
  <Svg size={size}>
    <circle cx="12" cy="8" r="4" />
    <path d="M4.5 21a7.5 7.5 0 0 1 15 0" />
  </Svg>
);

export const CloseIcon = ({ size }: P) => (
  <Svg size={size}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Svg>
);

export const PlusIcon = ({ size }: P) => (
  <Svg size={size}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);

export const ChevronIcon = ({ size, left }: P & { left?: boolean }) => (
  <Svg size={size}>
    <path d={left ? "M15 5l-7 7 7 7" : "M9 5l7 7-7 7"} />
  </Svg>
);

export const CameraIcon = ({ size }: P) => (
  <Svg size={size}>
    <path d="M4 8h3l1.5-2.5h7L17 8h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" />
    <circle cx="12" cy="13.5" r="3.5" />
  </Svg>
);
