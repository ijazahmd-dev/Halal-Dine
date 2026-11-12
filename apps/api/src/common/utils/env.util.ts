export function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

const DURATION_UNIT_SECONDS: Record<string, number> = {
  s: 1,
  m: 60,
  h: 3600,
  d: 86400,
};

export function parseDurationToSeconds(raw: string | undefined, fallbackSeconds: number): number {
  if (!raw) {
    return fallbackSeconds;
  }
  const match = raw.trim().match(/^(\d+)(s|m|h|d)$/);
  if (!match || !match[1] || !match[2]) {
    return fallbackSeconds;
  }
  const value = Number(match[1]);
  const multiplier = DURATION_UNIT_SECONDS[match[2]];
  if (!Number.isFinite(value) || value <= 0 || !multiplier) {
    return fallbackSeconds;
  }
  return value * multiplier;
}
