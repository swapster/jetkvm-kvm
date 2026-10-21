type Point = { x: number; y: number };

/** Direct touch: tap/drag, long press for right click, two fingers to scroll. */
export function attachTouchMouse(
  element: HTMLElement,
  move: (position: Point, delta: Point, buttons: number) => void,
  scroll: (delta: Point) => void,
  relative = false,
) {
  const contacts = new Map<number, Point>();
  let origin: Point | null = null;
  let last: Point = { x: 0, y: 0 };
  let dragging = false;
  let scrolling = false;
  let rightClicked = false;
  let relativeDrag = false;
  let lastTapAt = -Infinity;
  let scrollDelta = { x: 0, y: 0 };
  let longPress: ReturnType<typeof setTimeout> | undefined;
  const zero = { x: 0, y: 0 };
  const controller = new AbortController();
  const { signal } = controller;

  const clearLongPress = () => clearTimeout(longPress);
  const local = (event: PointerEvent): Point => {
    const rect = element.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  const reset = () => {
    clearLongPress();
    if (contacts.size || dragging) move(last, zero, 0);
    contacts.clear();
    origin = null;
    dragging = false;
    scrolling = false;
    rightClicked = false;
    relativeDrag = false;
    scrollDelta = { x: 0, y: 0 };
  };

  element.addEventListener(
    "pointerdown",
    event => {
      if (event.pointerType !== "touch") return;
      event.preventDefault();
      const point = local(event);
      contacts.set(event.pointerId, point);
      element.setPointerCapture(event.pointerId);
      clearLongPress();
      if (contacts.size !== 1) {
        scrolling = true;
        dragging = false;
        move(last, zero, 0);
        return;
      }
      last = origin = point;
      relativeDrag = relative && performance.now() - lastTapAt < 300;
      lastTapAt = -Infinity;
      dragging = relativeDrag;
      move(point, zero, relativeDrag ? 1 : 0);
      if (relativeDrag) return;
      longPress = setTimeout(() => {
        rightClicked = true;
        move(last, zero, 2);
        move(last, zero, 0);
      }, 550);
    },
    { signal },
  );

  element.addEventListener(
    "pointermove",
    event => {
      const previous = contacts.get(event.pointerId);
      if (!previous) return;
      event.preventDefault();
      const point = local(event);
      const delta = { x: point.x - previous.x, y: point.y - previous.y };
      contacts.set(event.pointerId, point);
      last = point;
      if (scrolling) {
        if (contacts.size >= 2) {
          scrollDelta.x -= delta.x / contacts.size;
          scrollDelta.y -= delta.y / contacts.size;
          const steps = { x: Math.trunc(scrollDelta.x / 16), y: Math.trunc(scrollDelta.y / 16) };
          if (steps.x || steps.y) {
            scroll({ x: steps.x * 100, y: steps.y * 100 });
            scrollDelta.x -= steps.x * 16;
            scrollDelta.y -= steps.y * 16;
          }
        }
        return;
      }
      if (rightClicked || !origin) return;
      if (!dragging && Math.hypot(point.x - origin.x, point.y - origin.y) < 8) return;
      clearLongPress();
      if (!dragging) {
        delta.x = point.x - origin.x;
        delta.y = point.y - origin.y;
        if (!relative) move(origin, zero, 1);
      }
      dragging = true;
      move(point, delta, !relative || relativeDrag ? 1 : 0);
    },
    { signal },
  );

  element.addEventListener(
    "pointerup",
    event => {
      if (!contacts.has(event.pointerId)) return;
      event.preventDefault();
      clearLongPress();
      last = local(event);
      if (!scrolling && !rightClicked && !dragging) {
        move(last, zero, 1);
        lastTapAt = performance.now();
      }
      if (!scrolling) move(last, zero, 0);
      contacts.delete(event.pointerId);
      if (!contacts.size) reset();
    },
    { signal },
  );

  const cancel = (event: PointerEvent) => {
    if (contacts.has(event.pointerId)) reset();
  };
  element.addEventListener("pointercancel", cancel, { signal });
  element.addEventListener("lostpointercapture", cancel, { signal });
  window.addEventListener("blur", reset, { signal });
  document.addEventListener("visibilitychange", reset, { signal });

  return () => {
    reset();
    controller.abort();
  };
}
