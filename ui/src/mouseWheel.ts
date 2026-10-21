export type WheelDelta = Pick<WheelEvent, "deltaMode" | "deltaX" | "deltaY">;

export function createWheelAccumulator() {
  let pendingX = 0;
  let pendingY = 0;

  return (event: WheelDelta, pageHeight: number) => {
    // One wheel notch is 100 CSS pixels or three lines. Read deltaMode first:
    // browsers may choose the delta units based on whether it was accessed.
    const unit = event.deltaMode === 1 ? 100 / 3 : event.deltaMode === 2 ? pageHeight : 1;
    pendingX += event.deltaX * unit;
    pendingY += event.deltaY * unit;

    // HID accepts integer wheel steps. Keep sub-step movement between events
    // instead of promoting every small trackpad event to a complete notch.
    const x = Math.trunc(pendingX / 100);
    const y = Math.trunc(pendingY / 100);
    pendingX -= x * 100;
    pendingY -= y * 100;

    return {
      x: Math.max(-127, Math.min(127, x)),
      y: Math.max(-127, Math.min(127, y)),
    };
  };
}
