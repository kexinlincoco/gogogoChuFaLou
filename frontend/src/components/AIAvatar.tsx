export function AIAvatar({ size = 32 }: { size?: number }) {
  return (
    <svg className="ai-avatar" width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
      <circle cx="20" cy="20" r="14" fill="#16587B" />
      <g stroke="#FFFFFF" strokeWidth={2} strokeLinecap="round">
        <line x1="20" y1="2" x2="20" y2="7" />
        <line x1="20" y1="33" x2="20" y2="38" />
        <line x1="2" y1="20" x2="7" y2="20" />
        <line x1="33" y1="20" x2="38" y2="20" />
        <line x1="7.5" y1="7.5" x2="10.8" y2="10.8" />
        <line x1="29.2" y1="29.2" x2="32.5" y2="32.5" />
        <line x1="7.5" y1="32.5" x2="10.8" y2="29.2" />
        <line x1="29.2" y1="10.8" x2="32.5" y2="7.5" />
      </g>
      <circle cx="15" cy="19" r="1.6" fill="#fff" />
      <circle cx="25" cy="19" r="1.6" fill="#fff" />
      <path d="M14 24 Q20 28 26 24" stroke="#fff" strokeWidth={2} fill="none" strokeLinecap="round" />
    </svg>
  );
}
