export interface Box {
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
}

export interface Rect extends Box {
  readonly right: number;
  readonly bottom: number;
}

export interface Size {
  readonly width: number;
  readonly height: number;
}

const GAP = 12;
const VIEWPORT_MARGIN = 12;

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(Math.max(value, minimum), Math.max(minimum, maximum));

export function tourGeometry(target: Rect, viewport: Size, card: Size) {
  const below = target.bottom + GAP;
  const top =
    below + card.height <= viewport.height - VIEWPORT_MARGIN
      ? below
      : Math.max(VIEWPORT_MARGIN, target.top - GAP - card.height);

  return {
    panes: [
      { top: 0, left: 0, width: viewport.width, height: target.top },
      {
        top: target.bottom,
        left: 0,
        width: viewport.width,
        height: Math.max(0, viewport.height - target.bottom),
      },
      { top: target.top, left: 0, width: target.left, height: target.height },
      {
        top: target.top,
        left: target.right,
        width: Math.max(0, viewport.width - target.right),
        height: target.height,
      },
    ],
    card: {
      top,
      left: clamp(target.left, VIEWPORT_MARGIN, viewport.width - card.width - VIEWPORT_MARGIN),
    },
  };
}
