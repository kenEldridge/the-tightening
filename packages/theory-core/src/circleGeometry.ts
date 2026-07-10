import { FIFTHS_ORDER, nodeIdToChordName } from './chordPathfinder';

/**
 * Circle-of-fifths geometry + camera math, shared by the desktop and mobile
 * CircleOfFifths components (issue #18: dynamic zoom-to-walk view).
 *
 * Node positions are fixed; the "camera" is just the SVG viewBox.
 */

// Layout constants (previously duplicated in both components).
// Ring radii are spread so the same-spoke edges (relative: major↔minor,
// leading-tone: minor↔dim) clear both node circles plus edge padding.
export const CIRCLE_CX = 300;
export const CIRCLE_CY = 300;
export const CIRCLE_SIZE = 600;
export const R_MAJOR = 258;
export const R_MINOR = 175;
export const R_DIM = 98;
export const NODE_R_MAJOR = 30;
export const NODE_R_MINOR = 26;
export const NODE_R_DIM = 22;

export type CircleLayout = 'fifths' | 'chromatic';

export interface CircleNode {
  id: string;        // node ID (key-0, minor-0, ...)
  name: string;      // chord name
  x: number;
  y: number;
  r: number;
  ring: 'major' | 'minor' | 'dim';
}

/**
 * Positions for all 36 ring nodes.
 * Fifths layout: angle by circle-of-fifths index. Chromatic layout: angle by
 * each ring's root pitch class so C / Cm / Cdim share a spoke.
 */
export function ringNodePositions(layout: CircleLayout = 'fifths'): CircleNode[] {
  const nodes: CircleNode[] = [];
  for (let i = 0; i < 12; i++) {
    const majorPc = FIFTHS_ORDER[i];
    const minorRootPc = (majorPc + 9) % 12;
    const dimRootPc = (majorPc + 11) % 12;

    const angleOf = (pc: number) =>
      layout === 'chromatic' ? (pc / 12) * 2 * Math.PI - Math.PI / 2 : (i / 12) * 2 * Math.PI - Math.PI / 2;

    const majorAngle = angleOf(majorPc);
    const minorAngle = angleOf(minorRootPc);
    const dimAngle = angleOf(dimRootPc);

    nodes.push(
      {
        id: `key-${i}`,
        name: nodeIdToChordName(`key-${i}`),
        x: CIRCLE_CX + R_MAJOR * Math.cos(majorAngle),
        y: CIRCLE_CY + R_MAJOR * Math.sin(majorAngle),
        r: NODE_R_MAJOR,
        ring: 'major',
      },
      {
        id: `minor-${i}`,
        name: nodeIdToChordName(`minor-${i}`),
        x: CIRCLE_CX + R_MINOR * Math.cos(minorAngle),
        y: CIRCLE_CY + R_MINOR * Math.sin(minorAngle),
        r: NODE_R_MINOR,
        ring: 'minor',
      },
      {
        id: `dim-${i}`,
        name: nodeIdToChordName(`dim-${i}`),
        x: CIRCLE_CX + R_DIM * Math.cos(dimAngle),
        y: CIRCLE_CY + R_DIM * Math.sin(dimAngle),
        r: NODE_R_DIM,
        ring: 'dim',
      },
    );
  }
  return nodes;
}

// --- Camera ---

export interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const FULL_VIEWBOX: ViewBox = { x: 0, y: 0, w: CIRCLE_SIZE, h: CIRCLE_SIZE };

/** Clearance around highlighted nodes: node radius + glow ring + step badges + arc bulge headroom. */
const CAMERA_PAD = 56;
/** Never zoom tighter than this (keeps 2-node paths readable, avoids comical zoom). */
const MIN_VIEW = 240;

export function viewBoxToString(vb: ViewBox): string {
  return `${vb.x} ${vb.y} ${vb.w} ${vb.h}`;
}

export function viewBoxesEqual(a: ViewBox, b: ViewBox, epsilon = 0.5): boolean {
  return (
    Math.abs(a.x - b.x) < epsilon &&
    Math.abs(a.y - b.y) < epsilon &&
    Math.abs(a.w - b.w) < epsilon &&
    Math.abs(a.h - b.h) < epsilon
  );
}

/**
 * Square viewBox framing the named chords' nodes with comfortable margin,
 * clamped inside the full circle view. Falls back to the full view when no
 * names resolve.
 */
export function walkViewBox(chordNames: string[], layout: CircleLayout = 'fifths'): ViewBox {
  const byName = new Map(ringNodePositions(layout).map((n) => [n.name, n]));
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let found = false;
  for (const name of chordNames) {
    const n = byName.get(name);
    if (!n) continue;
    found = true;
    minX = Math.min(minX, n.x - n.r - CAMERA_PAD);
    minY = Math.min(minY, n.y - n.r - CAMERA_PAD);
    maxX = Math.max(maxX, n.x + n.r + CAMERA_PAD);
    maxY = Math.max(maxY, n.y + n.r + CAMERA_PAD);
  }
  if (!found) return FULL_VIEWBOX;

  // Square up (expand the smaller dimension around its center), enforce MIN_VIEW.
  let w = maxX - minX;
  let h = maxY - minY;
  const side = Math.min(CIRCLE_SIZE, Math.max(w, h, MIN_VIEW));
  let x = minX + w / 2 - side / 2;
  let y = minY + h / 2 - side / 2;

  // Clamp inside the full view.
  x = Math.max(0, Math.min(x, CIRCLE_SIZE - side));
  y = Math.max(0, Math.min(y, CIRCLE_SIZE - side));

  return { x, y, w: side, h: side };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function interpolateViewBox(a: ViewBox, b: ViewBox, t: number): ViewBox {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), w: lerp(a.w, b.w, t), h: lerp(a.h, b.h, t) };
}

export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * Camera transition from one framing to another, Google-Maps style: when both
 * ends are zoomed-in framings, fly out to the full circle mid-way, then back
 * in. Pass linear t ∈ [0, 1]; easing is applied per phase internally.
 */
export function cameraTransition(from: ViewBox, to: ViewBox): (t: number) => ViewBox {
  const fromIsFull = viewBoxesEqual(from, FULL_VIEWBOX, 2);
  const toIsFull = viewBoxesEqual(to, FULL_VIEWBOX, 2);
  if (fromIsFull || toIsFull || viewBoxesEqual(from, to, 2)) {
    return (t) => interpolateViewBox(from, to, easeInOutCubic(Math.max(0, Math.min(1, t))));
  }
  return (t) => {
    const tt = Math.max(0, Math.min(1, t));
    if (tt < 0.5) return interpolateViewBox(from, FULL_VIEWBOX, easeInOutCubic(tt * 2));
    return interpolateViewBox(FULL_VIEWBOX, to, easeInOutCubic((tt - 0.5) * 2));
  };
}
