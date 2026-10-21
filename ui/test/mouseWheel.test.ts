import assert from "node:assert/strict";
import { test } from "node:test";
import { createWheelAccumulator } from "../src/mouseWheel.ts";

const pixels = (deltaY: number, deltaX = 0) => ({ deltaMode: 0, deltaX, deltaY });

test("a slow trackpad gesture does not become one notch per event", () => {
  const accumulate = createWheelAccumulator();
  for (let i = 0; i < 199; i++) {
    assert.deepEqual(accumulate(pixels(0.5), 800), { x: 0, y: 0 });
  }
  assert.deepEqual(accumulate(pixels(0.5), 800), { x: 0, y: 1 });
});

test("equal travel produces equal steps regardless of event frequency", () => {
  for (const delta of [1, 5, 25, 100, 250]) {
    const accumulate = createWheelAccumulator();
    let steps = 0;
    for (let distance = 0; distance < 500; distance += delta) {
      steps += accumulate(pixels(delta), 800).y;
    }
    assert.equal(steps, 5);
  }
});

test("fractional movement survives reports on both axes", () => {
  const accumulate = createWheelAccumulator();
  assert.deepEqual(accumulate(pixels(-150, 250), 800), { x: 2, y: -1 });
  assert.deepEqual(accumulate(pixels(-50, 50), 800), { x: 1, y: -1 });
  assert.deepEqual(accumulate(pixels(0), 800), { x: 0, y: 0 });
});

test("reversing direction cancels the unfinished step", () => {
  const accumulate = createWheelAccumulator();
  accumulate(pixels(75), 800);
  assert.deepEqual(accumulate(pixels(-75), 800), { x: 0, y: 0 });
  assert.deepEqual(accumulate(pixels(-100), 800), { x: 0, y: -1 });
});

test("mouse detents and browser line/page units stay proportional", () => {
  const accumulate = createWheelAccumulator();
  assert.equal(accumulate(pixels(100), 800).y, 1);
  assert.equal(accumulate({ deltaMode: 1, deltaX: 0, deltaY: 3 }, 800).y, 1);
  assert.equal(accumulate({ deltaMode: 2, deltaX: 0, deltaY: -1 }, 800).y, -8);
});

test("large events stay within the signed HID byte without delayed overflow", () => {
  const accumulate = createWheelAccumulator();
  assert.deepEqual(accumulate(pixels(100000, -100000), 800), { x: -127, y: 127 });
  assert.deepEqual(accumulate(pixels(0), 800), { x: 0, y: 0 });
});
