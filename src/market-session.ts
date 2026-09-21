export type MarketPollState = 'trading' | 'lunch' | 'closed' | 'hidden';

export type MarketPollPlan = {
  state: MarketPollState;
  delayMs: number;
};

export function remainingPollDelay(delayMs: number, elapsedMs: number): number {
  return Math.max(0, delayMs - Math.max(0, elapsedMs));
}

export function marketPollPlan(now: Date, hidden = false, alwaysOpen = false): MarketPollPlan {
  if (hidden) return { state: 'hidden', delayMs: 60_000 };
  if (alwaysOpen) return { state: 'trading', delayMs: 5_000 };

  const shanghai = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const weekday = shanghai.getUTCDay();
  if (weekday === 0 || weekday === 6) return { state: 'closed', delayMs: 60_000 };

  const minute = shanghai.getUTCHours() * 60 + shanghai.getUTCMinutes();
  if ((minute >= 9 * 60 + 15 && minute <= 11 * 60 + 30)
    || (minute >= 13 * 60 && minute <= 15 * 60)) {
    // Two live hosts changed K-line, quote and transaction snapshots every
    // 2.635–3.253s. A 2s sample avoids locking to the roughly 3s source cycle.
    return { state: 'trading', delayMs: 2_000 };
  }
  if (minute > 11 * 60 + 30 && minute < 13 * 60) {
    return { state: 'lunch', delayMs: 30_000 };
  }
  return { state: 'closed', delayMs: 60_000 };
}
