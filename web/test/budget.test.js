import { describe, expect, it } from 'vitest';
import { createBudget } from '../src/instruments/budget.js';

function render(width, height, overrides = {}) {
  const texts = [], points = [];
  const painter = {
    w: width, h: height,
    textWidth: (text, pitch) => String(text).length * 6 * pitch,
    text(x, y, text, _color, _intensity, pitch) { texts.push({ x, y, text, width: this.textWidth(text, pitch), height: 7 * pitch }); },
    line: (x0, y0, x1, y1) => points.push([x0, y0], [x1, y1]),
    poly: (vertices) => points.push(...vertices),
    dot: (x, y) => points.push([x, y]),
  };
  const station = {
    profile: { slo: { target: 0.99, days: 30 } },
    almanac: { analyse: () => ({ end: 1000, remaining: 1, consumed: 0, daysLeft: Infinity, burn1h: 0, burn6h: 0, coverage: 0.01, ...overrides }) },
  };
  createBudget(station).render(null, null, { now: 1000, dt: 1 / 60 }, painter);
  return { texts, points };
}

const overlaps = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

describe('error budget sizing', () => {
  it.each([[333, 120], [224, 96], [180, 80], [460, 160], [700, 240]])('fits every readout and graduation inside a %i × %i glass', (width, height) => {
    const { texts, points } = render(width, height);
    expect(texts.some((t) => t.text.startsWith('HISTORY'))).toBe(true);
    expect(texts.some((t) => t.text === 'LEFT 100%')).toBe(true);
    for (const text of texts) {
      expect(text.x).toBeGreaterThanOrEqual(0);
      expect(text.y).toBeGreaterThanOrEqual(0);
      expect(text.x + text.width).toBeLessThanOrEqual(width);
      expect(text.y + text.height).toBeLessThanOrEqual(height);
    }
    for (let i = 0; i < texts.length; i++) {
      for (const other of texts.slice(i + 1)) expect(overlaps(texts[i], other), `${texts[i].text} overlaps ${other.text}`).toBe(false);
    }
    for (const [x, y] of points) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(width);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(height);
    }
  });

  it.each([
    { remaining: 0, consumed: 1.5, daysLeft: 0 },
    { remaining: 0.42, consumed: 0.58, daysLeft: 0.5, burn6h: 14.4 },
    { remaining: 1, coverage: 1, burn6h: NaN },
  ])('keeps the projection separate from the burn and history readouts', (state) => {
    const { texts } = render(333, 120, state);
    const readouts = texts.filter((t) => !/^\d+$/.test(t.text));
    for (let i = 1; i < readouts.length; i++) expect(readouts[i].y).toBeGreaterThan(readouts[i - 1].y + readouts[i - 1].height);
    if (state.coverage === 1) expect(readouts.some((t) => t.text.startsWith('HISTORY'))).toBe(false);
  });
});
