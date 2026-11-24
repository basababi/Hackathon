import test from "node:test";
import assert from "node:assert/strict";
import { measurePatch, evaluateReading } from "../src/color-reading.js";

const patch = (rgb, x) => ({
  rgb,
  spread: 0,
  left: x,
  right: x + 3,
  top: 10,
  bottom: 13,
});
const set = (rgb = [114, 114, 114]) => ({
  test: patch(rgb, 0),
  low: patch([50, 50, 50], 10),
  medium: patch([114, 114, 114], 20),
  high: patch([200, 200, 200], 30),
});
test("a clean sample matches the photographed reference even if they have identical RGB", () => {
  assert.equal(evaluateReading(set()).status, "medium");
});
test("overlapping patches and indistinguishable reference cards cannot produce a level", () => {
  const samples = set();
  samples.test = samples.high;
  assert.equal(evaluateReading(samples).issue, "overlap");
  const duplicate = set();
  duplicate.high.rgb = duplicate.low.rgb;
  assert.equal(evaluateReading(duplicate).issue, "references");
});
test("refuses a color outside the card, an ambiguous midpoint, and an uneven patch", () => {
  assert.equal(evaluateReading(set([0, 0, 255])).issue, "outside");
  assert.equal(evaluateReading(set([81, 81, 81])).issue, "ambiguous");
  const noisy = set();
  noisy.test.spread = 0.17;
  assert.equal(evaluateReading(noisy).issue, "texture");
});
test("pixel sample at a corner clips to the image and uses channel medians", () => {
  const context = {
    canvas: { width: 100, height: 100 },
    getImageData(left, top, w, h) {
      assert.deepEqual([left, top, w, h], [0, 0, 2, 2]);
      return {
        data: Uint8ClampedArray.from([
          80, 20, 10, 255, 80, 20, 10, 255, 80, 20, 10, 255, 240, 225, 255, 255,
        ]),
      };
    },
  };
  assert.deepEqual(measurePatch(context, 0, 0).rgb, [80, 20, 10]);
});
