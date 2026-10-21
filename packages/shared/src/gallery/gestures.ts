/**
 * Arithmetic of the full-screen viewer (F-051): pinch to zoom, drag to move a zoomed photo, swipe
 * to change photo. Pure functions, so the gestures are tested without a browser and the apps can
 * reuse the same rules.
 *
 * Coordinates are in pixels, measured from the centre of the viewing area; `x` and `y` are how far
 * the photo's centre has moved from it.
 */

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 5;
/** Zoom reached by a double tap. */
export const DOUBLE_TAP_ZOOM = 2.5;

export interface View {
  scale: number;
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export const RESET_VIEW: View = { scale: MIN_ZOOM, x: 0, y: 0 };

export const clampScale = (scale: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale));

/** Size a photo takes in the viewing area at zoom 1: the whole photo, never cropped nor enlarged. */
export function fitSize(content: Size, stage: Size): Size {
  if (content.width <= 0 || content.height <= 0 || stage.width <= 0 || stage.height <= 0) {
    return { width: 0, height: 0 };
  }
  const ratio = Math.min(stage.width / content.width, stage.height / content.height, 1);
  return { width: content.width * ratio, height: content.height * ratio };
}

/** Keeps the photo covering the viewing area: it can be dragged until its edge meets the edge. */
export function clampView(view: View, fitted: Size, stage: Size): View {
  const scale = clampScale(view.scale);
  const limitX = Math.max(0, (fitted.width * scale - stage.width) / 2);
  const limitY = Math.max(0, (fitted.height * scale - stage.height) / 2);
  return {
    scale,
    x: Math.min(limitX, Math.max(-limitX, view.x)),
    y: Math.min(limitY, Math.max(-limitY, view.y)),
  };
}

/** Zooms by `factor` around `point`, so the spot under the fingers stays under the fingers. */
export function zoomAt(view: View, factor: number, point: Point): View {
  const scale = clampScale(view.scale * factor);
  const applied = scale / view.scale;
  return {
    scale,
    x: point.x - (point.x - view.x) * applied,
    y: point.y - (point.y - view.y) * applied,
  };
}

export const distanceBetween = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

export const midpointOf = (a: Point, b: Point): Point => ({
  x: (a.x + b.x) / 2,
  y: (a.y + b.y) / 2,
});

/** A swipe must be this far (px), or this fast, and clearly more horizontal than vertical. */
export const SWIPE_DISTANCE = 60;
export const SWIPE_SHORT_DISTANCE = 30;
export const SWIPE_SPEED = 0.4;

/**
 * The photo to go to after a one-finger drag from rest, or null when it was not a swipe: a tap, a
 * vertical scroll, or a drag too short and slow.
 */
export function swipeDirection(
  dx: number,
  dy: number,
  elapsedMs: number,
): "next" | "previous" | null {
  const horizontal = Math.abs(dx);
  if (horizontal < SWIPE_SHORT_DISTANCE || horizontal < Math.abs(dy) * 1.5) return null;
  const fast = elapsedMs > 0 && horizontal / elapsedMs >= SWIPE_SPEED;
  if (horizontal < SWIPE_DISTANCE && !fast) return null;
  // Dragging left brings the next photo in, as with a book.
  return dx < 0 ? "next" : "previous";
}
