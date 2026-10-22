import assert from "node:assert/strict";
import { test } from "node:test";
import { attachTouchMouse } from "../src/touchMouse.ts";

function harness() {
  Object.assign(globalThis, { window: new EventTarget(), document: new EventTarget() });
  const element = Object.assign(new EventTarget(), {
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
    setPointerCapture: () => {},
  });
  const buttons: number[] = [];
  const wheel: { x: number; y: number }[] = [];
  const dispose = attachTouchMouse(
    element as unknown as HTMLElement,
    (_position, _delta, pressed) => buttons.push(pressed),
    delta => wheel.push(delta),
  );
  const pointer = (type: string, id: number, x: number, y: number) => {
    element.dispatchEvent(
      Object.assign(new Event(type, { cancelable: true }), {
        pointerType: "touch",
        pointerId: id,
        clientX: x,
        clientY: y,
      }),
    );
  };
  return { pointer, buttons, wheel, dispose };
}

test("parallel fingers still scroll in accumulated steps", () => {
  const h = harness();
  try {
    h.pointer("pointerdown", 1, 50, 50);
    h.pointer("pointerdown", 2, 100, 50);
    h.pointer("pointermove", 1, 50, 70);
    assert.deepEqual(h.wheel, []);
    h.pointer("pointermove", 2, 100, 70);
    assert.deepEqual(h.wheel, [{ x: 0, y: -100 }]);
    assert.ok(h.buttons.every(value => value === 0));
  } finally {
    h.dispose();
  }
});

test("an asymmetric pinch does not become a remote scroll", () => {
  const h = harness();
  try {
    h.pointer("pointerdown", 1, 50, 50);
    h.pointer("pointerdown", 2, 100, 50);
    h.pointer("pointermove", 1, 10, 20);
    h.pointer("pointermove", 2, 110, 60);
    assert.deepEqual(h.wheel, []);
    h.pointer("pointercancel", 1, 10, 20);
    h.pointer("pointermove", 2, 120, 100);
    h.pointer("pointerup", 2, 120, 100);
    assert.deepEqual(h.wheel, []);
    assert.ok(h.buttons.every(value => value === 0));
    h.pointer("pointerdown", 3, 50, 50);
    h.pointer("pointerup", 3, 50, 50);
    assert.deepEqual(h.buttons.slice(-2), [1, 0]);
  } finally {
    h.dispose();
  }
});

test("browser cancellation releases a remote drag", () => {
  const h = harness();
  try {
    h.pointer("pointerdown", 1, 50, 50);
    h.pointer("pointermove", 1, 70, 50);
    assert.equal(h.buttons.at(-1), 1);
    h.pointer("pointercancel", 1, 70, 50);
    assert.equal(h.buttons.at(-1), 0);
  } finally {
    h.dispose();
  }
});
