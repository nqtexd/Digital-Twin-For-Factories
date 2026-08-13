export function FlowTwinLogo({ size = 40 }: { size?: number }) {
  return <svg className="flowtwin-logo" width={size} height={size} viewBox="0 0 40 40" fill="none" role="img" aria-label="FlowTwin">
    <rect x="1" y="1" width="38" height="38" rx="10" fill="currentColor"/>
    <path d="M9 12h10c6.5 0 6.5 8 12 8" stroke="var(--logo-line,#27160d)" strokeWidth="2.4" strokeLinecap="round"/>
    <path d="M9 28h10c6.5 0 6.5-8 12-8" stroke="var(--logo-line,#27160d)" strokeWidth="2.4" strokeLinecap="round"/>
    <circle cx="9" cy="12" r="2.3" fill="var(--logo-line,#27160d)"/>
    <circle cx="9" cy="28" r="2.3" fill="var(--logo-line,#27160d)"/>
    <circle cx="31" cy="20" r="2.6" fill="var(--logo-line,#27160d)"/>
  </svg>
}
