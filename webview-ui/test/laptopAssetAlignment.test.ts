import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { PNG } from 'pngjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const furnitureRoot = path.join(root, 'public', 'assets', 'furniture');

interface Bounds {
  minY: number;
  maxY: number;
}

function readOpaqueBounds(filePath: string): Bounds {
  const png = PNG.sync.read(readFileSync(filePath));
  let minY = png.height;
  let maxY = -1;

  for (let y = 0; y < png.height; y += 1) {
    for (let x = 0; x < png.width; x += 1) {
      const alpha = png.data[(y * png.width + x) * 4 + 3];
      if (alpha === 0) continue;
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }

  return { minY, maxY };
}

test('laptop front/back views sit at a similar desk depth as the approved side profile', () => {
  for (const palette of ['BEIGE', 'GRAPHITE', 'SILVER']) {
    const prefix = `LAPTOP_${palette}`;
    const dir = path.join(furnitureRoot, prefix);
    const side = readOpaqueBounds(path.join(dir, `${prefix}_SIDE.png`));
    const expectedMinDepth = side.maxY - 2;

    for (const fileName of [
      `${prefix}_FRONT_OFF.png`,
      `${prefix}_FRONT_ON_1.png`,
      `${prefix}_FRONT_ON_2.png`,
      `${prefix}_FRONT_ON_3.png`,
      `${prefix}_BACK.png`,
    ]) {
      const bounds = readOpaqueBounds(path.join(dir, fileName));
      assert.ok(
        bounds.maxY >= expectedMinDepth,
        `${fileName} bottoms out at row ${bounds.maxY}, which is too shallow compared with the approved side profile at row ${side.maxY}.`,
      );
      assert.ok(
        bounds.minY <= side.minY + 1,
        `${fileName} starts too low in the canvas and no longer lines up with the side profile.`,
      );
    }
  }
});
