export function BrandMark({ className = 'w-8 h-8' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <rect x="2" y="2" width="36" height="36" rx="9" fill="#0E4D3A" />
      {/* Contoured Earth Horizon */}
      <path
        d="M7 26.5C11.5 22.8 16.5 22.2 21.5 24.4C26 26.4 30 25.6 33.5 22.2"
        stroke="#D4A13E"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M8.5 31C13 28.2 18 28 23.5 29.8C27.5 31 30.8 30.2 33.5 28.2"
        stroke="#FAF8F3"
        strokeOpacity="0.45"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      {/* Orbital Arc */}
      <path
        d="M9 15.5C12.5 9.5 21 7.2 28.2 10.2"
        stroke="#FAF8F3"
        strokeOpacity="0.8"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeDasharray="2 3"
      />
      {/* Satellite Node */}
      <circle cx="29.5" cy="10.8" r="2.2" fill="#D4A13E" />
      {/* Directional Sprout / Vane */}
      <path
        d="M19.5 22.5V13.5M19.5 13.5C19.5 13.5 15.2 13.8 14.5 17.5C17.8 17.8 19.5 15.8 19.5 13.5ZM19.5 16C19.5 16 23.8 15.2 24.5 19C21.2 19.2 19.5 17.5 19.5 16Z"
        stroke="#FAF8F3"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
