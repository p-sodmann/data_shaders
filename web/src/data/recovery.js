export const RECOVERY_MS = 2200;

// Animation is a view over already-restored data. Alarms, readouts and analysis
// see the complete history immediately; only the archive traces reveal it.
export function recoveryFrame(recovery, wall = performance.now()) {
  if (!recovery || recovery.duration === 0) return null;
  const progress = Math.max(0, Math.min(1, (wall - recovery.at) / recovery.duration));
  if (progress >= 1) return null;
  const sweep = 1 - Math.pow(1 - progress, 2);
  return { ...recovery, progress, cursor: recovery.from + sweep * (recovery.to - recovery.from + 1), glow: Math.min(1, (1 - progress) * 8) };
}

export const revealed = (t, recovery) => !recovery || t < recovery.from || t > recovery.to || t <= recovery.cursor;
