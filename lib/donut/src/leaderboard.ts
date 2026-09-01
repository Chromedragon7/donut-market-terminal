export interface ParsedValue {
  numeric: number | null;
  durationSeconds: number | null;
}

const DURATION_RE =
  /(?:(\d+)\s*d)?\s*(?:(\d+)\s*h)?\s*(?:(\d+)\s*m)?\s*(?:(\d+)\s*s)?/i;

function parseDuration(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/[dhms]/i.test(trimmed)) return null;
  const m = DURATION_RE.exec(trimmed);
  if (!m) return null;
  const [, d, h, min, s] = m;
  if (!d && !h && !min && !s) return null;
  return (
    (Number(d ?? 0) * 86400) +
    (Number(h ?? 0) * 3600) +
    (Number(min ?? 0) * 60) +
    Number(s ?? 0)
  );
}

function parseNumeric(raw: string): number | null {
  const cleaned = raw.replace(/[$,\s]/g, "");
  const m = /^(-?\d+(?:\.\d+)?)([kmbt])?$/i.exec(cleaned);
  if (m) {
    const base = Number(m[1]);
    const suffix = (m[2] ?? "").toLowerCase();
    const mult =
      suffix === "k"
        ? 1e3
        : suffix === "m"
          ? 1e6
          : suffix === "b"
            ? 1e9
            : suffix === "t"
              ? 1e12
              : 1;
    return Number.isFinite(base) ? base * mult : null;
  }
  const plain = Number(cleaned);
  return Number.isFinite(plain) ? plain : null;
}

export function parseLeaderboardValue(raw: string | undefined): ParsedValue {
  if (raw === undefined || raw === null) {
    return { numeric: null, durationSeconds: null };
  }
  try {
    const durationSeconds = parseDuration(raw);
    if (durationSeconds !== null) {
      return { numeric: null, durationSeconds };
    }
    return { numeric: parseNumeric(raw), durationSeconds: null };
  } catch {
    return { numeric: null, durationSeconds: null };
  }
}

export const LEADERBOARD_CATEGORIES = [
  "brokenblocks",
  "deaths",
  "kills",
  "mobskilled",
  "money",
  "placedblocks",
  "playtime",
  "sell",
  "shards",
  "shop",
] as const;

export type LeaderboardCategory = (typeof LEADERBOARD_CATEGORIES)[number];

export function isLeaderboardCategory(v: string): v is LeaderboardCategory {
  return (LEADERBOARD_CATEGORIES as readonly string[]).includes(v);
}
