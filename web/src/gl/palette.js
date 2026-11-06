// JS mirror of the GLSL phosphors in shaders.js.
export const PH = {
  ok: [0.5, 1.0, 0.72],
  warn: [1.0, 0.7, 0.26],
  crit: [1.0, 0.33, 0.1],
};
export const STATE_COLORS = [PH.ok, PH.warn, PH.crit, PH.ok];
export const sevOf = (v, warn, crit) => (v >= crit ? PH.crit : v >= warn ? PH.warn : PH.ok);
