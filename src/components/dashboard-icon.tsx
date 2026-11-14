import type { ReactNode } from "react";

const symbols = {
  brand: <><path d="M3 16 12 4l9 12-9 4-9-4Z" /><path d="m3 16 9-3 9 3M12 13V4m0 9v7" /></>,
  field: <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="m3 14 7-6 11 9m-8-6 4-4 4 4" /></>,
  climate: <><path d="M3 17h18M4 13l5-5 4 4 6-7" /><path d="M16 5h3v3" /></>,
  crop: <><path d="M12 21v-8m0 4C5 17 4 13 4 9c5 0 8 3 8 7m0-3c0-5 3-8 8-9 0 5-3 9-8 9" /></>,
  rotation: <><path d="M4 11a8 8 0 0 1 14-5l2 3m0-5v5h-5m5 4a8 8 0 0 1-14 5l-2-3m0 5v-5h5" /></>,
  pin: <><path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z" /><circle cx="12" cy="10" r="2.25" /></>,
  arrow: <path d="M4 12h15m-6-6 6 6-6 6" />,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5m0-8h.01" /></>,
  chevron: <path d="m9 6 6 6-6 6" />,
} satisfies Record<string, ReactNode>;

export function DashboardIcon({ name, size = 20 }: { name: keyof typeof symbols; size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round">
      {symbols[name]}
    </svg>
  );
}
