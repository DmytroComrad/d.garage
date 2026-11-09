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

/** Шестерня: налаштування й профіль машини. */
export const GearIcon = ({ size }: P) => (
  <Svg size={size}>
    <path d="M10.31 5.21L10.66 2.49L13.34 2.49L13.69 5.21A7 7 0 0 1 15.61 6L17.78 4.33L19.67 6.22L18 8.39A7 7 0 0 1 18.79 10.31L21.51 10.66L21.51 13.34L18.79 13.69A7 7 0 0 1 18 15.61L19.67 17.78L17.78 19.67L15.61 18A7 7 0 0 1 13.69 18.79L13.34 21.51L10.66 21.51L10.31 18.79A7 7 0 0 1 8.39 18L6.22 19.67L4.33 17.78L6 15.61A7 7 0 0 1 5.21 13.69L2.49 13.34L2.49 10.66L5.21 10.31A7 7 0 0 1 6 8.39L4.33 6.22L6.22 4.33L8.39 6A7 7 0 0 1 10.31 5.21Z" />
    <circle cx="12" cy="12" r="3" />
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

/** Воронка фільтра. */
export const FilterIcon = ({ size }: P) => (
  <Svg size={size}>
    <path d="M4 5h16l-6 7.5V19l-4-2v-4.5z" />
  </Svg>
);

export const FileIcon = ({ size }: P) => (
  <Svg size={size}>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5" />
  </Svg>
);

export const NoteIcon = ({ size }: P) => (
  <Svg size={size}>
    <path d="M5 4h14v16H5z" />
    <path d="M9 9h6M9 13h6M9 17h3" />
  </Svg>
);

export const PencilIcon = ({ size }: P) => (
  <Svg size={size}>
    <path d="M4 20h4L19 9l-4-4L4 16z" />
    <path d="M13.5 6.5l4 4" />
  </Svg>
);

export const ShareIcon = ({ size }: P) => (
  <Svg size={size}>
    <path d="M12 3v12" />
    <path d="M7 8l5-5 5 5" />
    <path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />
  </Svg>
);

export const TrashIcon = ({ size }: P) => (
  <Svg size={size}>
    <path d="M4 7h16" />
    <path d="M9 7V4.5h6V7" />
    <path d="M6 7l1 13h10l1-13" />
    <path d="M10 11v5M14 11v5" />
  </Svg>
);

export const CheckIcon = ({ size }: P) => (
  <Svg size={size}>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </Svg>
);

export const LinkIcon = ({ size }: P) => (
  <Svg size={size}>
    <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
    <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
  </Svg>
);

export const WarnIcon = ({ size }: P) => (
  <Svg size={size}>
    <path d="M12 4l9 16H3z" />
    <path d="M12 10v4M12 17v.5" />
  </Svg>
);

export const InfoIcon = ({ size }: P) => (
  <Svg size={size}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5M12 8v.5" />
  </Svg>
);

/*
 * Прапорці малюємо самі: Windows не показує емодзі-прапорці, замість них виходять літери.
 * Російська мова — лише для автора проєкту, тож замість прапорця в неї білий прямокутник.
 */
const Flag = ({ children }: { children: ReactNode }) => (
  <svg className="flag" width="22" height="15" viewBox="0 0 60 40" aria-hidden="true">
    {children}
  </svg>
);

/** Кореневий svg і так обрізає все за межами viewBox. */
export const FlagEn = () => (
  <Flag>
    <rect width="60" height="40" fill="#012169" />
    <path d="M0 0l60 40M60 0L0 40" stroke="#fff" strokeWidth="8" />
    <path d="M0 0l60 40M60 0L0 40" stroke="#C8102E" strokeWidth="3" />
    <path d="M30 0v40M0 20h60" stroke="#fff" strokeWidth="12" />
    <path d="M30 0v40M0 20h60" stroke="#C8102E" strokeWidth="7" />
  </Flag>
);

export const FlagUk = () => (
  <Flag>
    <rect width="60" height="20" fill="#0057B7" />
    <rect y="20" width="60" height="20" fill="#FFD700" />
  </Flag>
);

export const FlagBlank = () => (
  <Flag>
    <rect x="1" y="1" width="58" height="38" fill="#fff" stroke="#b9c0ca" strokeWidth="2" />
  </Flag>
);
