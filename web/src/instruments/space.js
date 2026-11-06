// Small 3D toolkit for vector instruments: a perspective camera and wireframe solids.

export function camera({ yaw = 0, pitch = 0, dist = 6, cx, cy, scale }) {
  const cyw = Math.cos(yaw), syw = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  // returns [screenX, screenY, depth, pixelsPerUnit]
  return (x, y, z) => {
    const X = x * cyw + z * syw;
    let Z = -x * syw + z * cyw;
    const Y = y * cp - Z * sp;
    Z = y * sp + Z * cp;
    const k = scale / (Z + dist);
    return [cx + X * k, cy - Y * k, Z, k];
  };
}

export function rotate([x, y, z], ay, ax) {
  const c = Math.cos(ay), s = Math.sin(ay);
  const X = x * c + z * s, Z = -x * s + z * c;
  const c2 = Math.cos(ax), s2 = Math.sin(ax);
  return [X, y * c2 - Z * s2, y * s2 + Z * c2];
}

// Edges of a convex solid are the vertex pairs at minimal distance.
function solid(verts) {
  const norm = verts.map((v) => {
    const l = Math.hypot(...v);
    return v.map((c) => c / l);
  });
  let min = Infinity;
  const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  for (let i = 0; i < norm.length; i++) for (let j = i + 1; j < norm.length; j++) min = Math.min(min, d(norm[i], norm[j]));
  const edges = [];
  for (let i = 0; i < norm.length; i++)
    for (let j = i + 1; j < norm.length; j++) if (d(norm[i], norm[j]) < min * 1.01) edges.push([i, j]);
  return { verts: norm, edges };
}

const PHI = (1 + Math.sqrt(5)) / 2;
const icoVerts = [];
for (const a of [-1, 1]) for (const b of [-PHI, PHI]) icoVerts.push([0, a, b], [a, b, 0], [b, 0, a]);

export const SOLIDS = {
  ico: solid(icoVerts),
  octa: solid([[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]),
  cube: solid([-1, 1].flatMap((x) => [-1, 1].flatMap((y) => [-1, 1].map((z) => [x, y, z])))),
  tetra: solid([[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]]),
};

// deterministic pseudo-random in [0,1)
export const hash = (n) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};
