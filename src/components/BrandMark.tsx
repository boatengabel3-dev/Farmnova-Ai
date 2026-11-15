import { useState } from 'react';

const LOGO_SRC = '/assets/aistudio/Gemini_Generated_Image_ymql5aymql5aymql_a65fc201.jpg';

export function BrandMark({
  className = 'w-9 h-9',
  variant = 'emblem',
}: {
  className?: string;
  variant?: 'emblem' | 'full';
}) {
  const [imgFailed, setImgFailed] = useState(false);

  if (imgFailed) {
    return (
      <svg
        viewBox="0 0 40 40"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={className}
        aria-hidden="true"
      >
        <circle cx="20" cy="20" r="18" fill="#0E4D3A" />
        <path
          d="M8 26.5C12.5 22.8 17 22.5 21.5 24.4C25.5 26.2 29.5 25.4 32.5 22.2"
          stroke="#D4A13E"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <path
          d="M20 22V12M20 12C20 12 15.5 13 15 17C18 17.2 20 15 20 12ZM20 15C20 15 24.5 14 25 18C22 18.2 20 16.5 20 15Z"
          stroke="#FAF8F3"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  if (variant === 'full') {
    return (
      <div className={`overflow-hidden rounded-lg bg-[#F4F3EE] border border-[#E2DDD1] ${className}`}>
        <img
          src={LOGO_SRC}
          alt="FarmNova AI — Smarter Farming. Stronger Futures."
          referrerPolicy="no-referrer"
          onError={() => setImgFailed(true)}
          className="w-full h-full object-contain"
        />
      </div>
    );
  }

  return (
    <div
      className={`relative rounded-full overflow-hidden bg-[#F4F3EE] border border-[#D8D2C3] shrink-0 ${className}`}
    >
      <img
        src={LOGO_SRC}
        alt="FarmNova AI logo"
        referrerPolicy="no-referrer"
        onError={() => setImgFailed(true)}
        className="h-[214%] w-auto max-w-none absolute left-1/2 -translate-x-1/2 top-[-28.5%] select-none pointer-events-none"
      />
    </div>
  );
}
