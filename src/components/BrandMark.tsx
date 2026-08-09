interface BrandMarkProps {
  className?: string;
}

/**
 * Trish Books app icon. Always sits next to the visible "Trish Books" wordmark,
 * so it stays aria-hidden to avoid announcing the name twice.
 */
export default function BrandMark({ className }: BrandMarkProps) {
  return (
    <svg
      viewBox="0 0 512 512"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <rect width="512" height="512" rx="112" fill="#0F6E56" />
      <path d="M150 196H362" stroke="#fff" strokeWidth="30" strokeLinecap="round" />
      <path d="M256 196V354" stroke="#fff" strokeWidth="30" strokeLinecap="round" />
      <circle cx="196" cy="272" r="20" fill="#5DCAA5" />
      <circle cx="316" cy="272" r="20" fill="#5DCAA5" />
      <circle cx="196" cy="330" r="20" fill="#5DCAA5" opacity="0.55" />
      <circle cx="316" cy="330" r="20" fill="#5DCAA5" opacity="0.55" />
    </svg>
  );
}
