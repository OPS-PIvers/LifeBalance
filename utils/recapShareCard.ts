import type { WeeklyRecap } from '@/types/schema';
import { roundMoney } from '@/utils/money';
import { formatCurrency, DEFAULT_CURRENCY } from '@/utils/formatCurrency';

/**
 * utils/recapShareCard.ts — F-DASH-09 shareable weekly recap card.
 *
 * Pure content selection (`buildRecapShareContent`) is unit-tested directly.
 * The canvas rendering (`renderRecapShareCard`) is DOM-dependent (same class
 * of code as `CaptureModal`'s canvas capture) and is exercised via manual/E2E
 * verification rather than jsdom canvas mocking.
 */

/** Headline figures picked out of a WeeklyRecap for the share card. Pure/testable. */
export interface RecapShareContent {
  isoWeek: string;
  totalSpendLabel: string;
  spendDeltaLabel: string | null;
  spendDeltaIsGood: boolean;
  habitCompletions: number;
  topMember: { name: string; points: number } | null;
  topStreak: { habitTitle: string; streakDays: number } | null;
}

/**
 * Selects and formats the handful of headline numbers worth putting on a
 * shareable image — deliberately a subset of the full WeeklyRecapDrawer detail
 * (a share card is a highlight reel, not a data dump).
 */
export function buildRecapShareContent(
  recap: WeeklyRecap,
  currency: string = DEFAULT_CURRENCY
): RecapShareContent {
  const fmt = (amount: number) => formatCurrency(amount, { currency, decimals: 0 });
  const diff = roundMoney(recap.totalSpend - recap.priorWeekSpend);
  const spendDeltaIsGood = diff <= 0;

  let spendDeltaLabel: string | null = null;
  if (recap.priorWeekSpend > 0 && diff !== 0) {
    spendDeltaLabel = `${fmt(Math.abs(diff))} ${diff < 0 ? 'less' : 'more'} than last week`;
  }

  const topMember = recap.pointsByMember.reduce<{ name: string; points: number } | null>((best, m) => {
    if (!best || m.points > best.points) return { name: m.name, points: m.points };
    return best;
  }, null);

  const topStreak = recap.streaksAtRisk.reduce<{ habitTitle: string; streakDays: number } | null>(
    (best, s) => {
      if (!best || s.streakDays > best.streakDays) return { habitTitle: s.habitTitle, streakDays: s.streakDays };
      return best;
    },
    null
  );

  return {
    isoWeek: recap.isoWeek,
    totalSpendLabel: fmt(recap.totalSpend),
    spendDeltaLabel,
    spendDeltaIsGood,
    habitCompletions: recap.habitCompletions,
    topMember,
    topStreak,
  };
}

const CARD_WIDTH = 1080;
const CARD_HEIGHT = 1350;

// DESIGN.md token hex values (index.css @theme) — canvas can't consume Tailwind
// classes, so the brand-*/accent-*/warm-* colors actually drawn are copied here.
const COLORS = {
  brand50: '#f8f7f4',
  brand200: '#e3e0d8',
  brand500: '#7c776c',
  brand900: '#161512',
  accent600: '#285742',
  accent700: '#214636',
  warm500: '#b87a29',
  moneyPos: '#1f8f63',
  moneyNeg: '#d4483f',
};

/** Loads the self-hosted brand fonts so canvas text renders as Fraunces/Schibsted Grotesk. */
async function loadShareCardFonts(): Promise<{ display: string; sans: string }> {
  const display = "'Fraunces'";
  const sans = "'Schibsted Grotesk'";
  try {
    const [fraunces, grotesk] = await Promise.all([
      new FontFace('Fraunces', "url('/fonts/fraunces-latin.woff2') format('woff2')", { weight: '600 700' }).load(),
      new FontFace('Schibsted Grotesk', "url('/fonts/schibsted-grotesk-latin.woff2') format('woff2')", {
        weight: '400 600',
      }).load(),
    ]);
    document.fonts.add(fraunces);
    document.fonts.add(grotesk);
    return { display, sans };
  } catch {
    // Font loading isn't universally supported/reliable (older Safari, offline
    // fonts race) — fall back to system serif/sans rather than failing the share.
    return { display: 'Georgia, serif', sans: 'system-ui, sans-serif' };
  }
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/**
 * Renders a Spotify-Wrapped-style shareable image for one WeeklyRecap.
 * Draws on an offscreen canvas using DESIGN.md brand colors/fonts and resolves
 * a PNG Blob ready for the Web Share API or a download link.
 */
export async function renderRecapShareCard(
  recap: WeeklyRecap,
  currency: string = DEFAULT_CURRENCY
): Promise<Blob> {
  const content = buildRecapShareContent(recap, currency);
  const { display, sans } = await loadShareCardFonts();

  const canvas = document.createElement('canvas');
  canvas.width = CARD_WIDTH;
  canvas.height = CARD_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');

  // Background — warm paper base with an evergreen footer band.
  ctx.fillStyle = COLORS.brand50;
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
  ctx.fillStyle = COLORS.accent700;
  ctx.fillRect(0, CARD_HEIGHT - 160, CARD_WIDTH, 160);

  // Eyebrow — week label.
  ctx.fillStyle = COLORS.warm500;
  ctx.font = `700 32px ${sans}`;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(`WEEK IN REVIEW · ${content.isoWeek}`, 72, 140);

  // Headline — total spend.
  ctx.fillStyle = COLORS.brand900;
  ctx.font = `700 128px ${display}`;
  ctx.fillText(content.totalSpendLabel, 72, 300);

  if (content.spendDeltaLabel) {
    ctx.fillStyle = content.spendDeltaIsGood ? COLORS.moneyPos : COLORS.moneyNeg;
    ctx.font = `600 40px ${sans}`;
    ctx.fillText(content.spendDeltaLabel, 72, 360);
  }

  // Divider.
  ctx.strokeStyle = COLORS.brand200;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(72, 420);
  ctx.lineTo(CARD_WIDTH - 72, 420);
  ctx.stroke();

  // Habit completions.
  ctx.fillStyle = COLORS.accent600;
  ctx.font = `700 96px ${display}`;
  ctx.fillText(String(content.habitCompletions), 72, 560);
  ctx.fillStyle = COLORS.brand500;
  ctx.font = `500 36px ${sans}`;
  ctx.fillText(`habit completion${content.habitCompletions === 1 ? '' : 's'} this week`, 72, 610);

  let cursorY = 700;
  if (content.topStreak) {
    ctx.fillStyle = COLORS.warm500;
    ctx.font = `700 56px ${display}`;
    ctx.fillText(`🔥 ${content.topStreak.streakDays}-day streak`, 72, cursorY);
    ctx.fillStyle = COLORS.brand500;
    ctx.font = `500 32px ${sans}`;
    const lines = wrapText(ctx, content.topStreak.habitTitle, CARD_WIDTH - 144);
    lines.forEach((line, i) => ctx.fillText(line, 72, cursorY + 48 + i * 40));
    cursorY += 48 + lines.length * 40 + 60;
  }

  if (content.topMember) {
    ctx.fillStyle = COLORS.brand900;
    ctx.font = `700 56px ${display}`;
    ctx.fillText(`${content.topMember.name} led with ${content.topMember.points} pts`, 72, cursorY);
  }

  // Footer wordmark.
  ctx.fillStyle = COLORS.brand50;
  ctx.font = `700 44px ${display}`;
  ctx.fillText('LifeBalance', 72, CARD_HEIGHT - 72);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob) resolve(blob);
      else reject(new Error('Failed to render share card'));
    }, 'image/png');
  });
}

/** Shares (or, as a fallback, downloads) the rendered recap card image. */
export async function shareRecapCard(recap: WeeklyRecap, currency: string = DEFAULT_CURRENCY): Promise<'shared' | 'downloaded'> {
  const blob = await renderRecapShareCard(recap, currency);
  const file = new File([blob], `lifebalance-recap-${recap.isoWeek}.png`, { type: 'image/png' });

  if (navigator.canShare?.({ files: [file] })) {
    await navigator.share({
      files: [file],
      title: 'My LifeBalance weekly recap',
      text: `My week in review · ${recap.isoWeek}`,
    });
    return 'shared';
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `lifebalance-recap-${recap.isoWeek}.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return 'downloaded';
}
