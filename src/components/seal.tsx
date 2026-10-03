// The product's signature element: a round seal stamped with the real hash of what was signed.
const TONE = { good: "var(--seal)", warn: "var(--hold)", bad: "var(--deny)", ink: "var(--ink)" } as const;

export function Seal({
  hash,
  label,
  tone = "good",
  size = 96,
  animate = false,
}: {
  hash: string;
  label: string;
  tone?: keyof typeof TONE;
  size?: number;
  animate?: boolean;
}) {
  const color = TONE[tone];
  const ring = `${label.toUpperCase()}  ${hash.slice(0, 24)}  `;
  const id = `seal-${hash.slice(0, 8)}-${label.length}`;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      role="img"
      aria-label={`${label}, hash ${hash.slice(0, 16)}`}
      className={animate ? "seal-stamp" : "rotate-[-8deg]"}
    >
      <defs>
        <path id={id} d="M50,50 m-36,0 a36,36 0 1,1 72,0 a36,36 0 1,1 -72,0" />
      </defs>
      <circle cx="50" cy="50" r="47" fill="none" stroke={color} strokeWidth="2.5" />
      <circle cx="50" cy="50" r="27" fill="none" stroke={color} strokeWidth="1.2" />
      <text fill={color} fontSize="7.4" fontFamily="var(--font-jetbrains), monospace" letterSpacing="0.6">
        <textPath href={`#${id}`}>{ring}</textPath>
      </text>
      <path d="M38 51 l8 8 l16 -18" fill="none" stroke={color} strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
