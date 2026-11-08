import assert from 'node:assert/strict';

// Draw through the real pointer handlers. Coordinates use the canvas width so
// the mark stays round on a tall screenshot and survives responsive scaling.
export async function drawAnnotationCircle(page, canvas) {
  await canvas.waitFor({ state: 'visible' });
  await canvas.evaluate(element => element.scrollIntoView({ block: 'start' }));
  const box = await canvas.boundingBox();
  assert.ok(box && box.width > 100 && box.height > 100);
  const circle = { cx: .28, cy: .19, rx: .22, ry: .11 };
  const point = angle => ({ x: box.x + box.width * (circle.cx + circle.rx * Math.cos(angle)), y: box.y + box.width * (circle.cy + circle.ry * Math.sin(angle)) });
  const start = point(0);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  for (let i = 1; i <= 64; i++) {
    const p = point(i / 64 * Math.PI * 2);
    await page.mouse.move(p.x, p.y);
  }
  await page.mouse.up();
  // Inspect the rendered canvas: a line or clipped gesture must never become
  // a manual image that claims to show a closed red circle.
  const coverage = await canvas.evaluate((element, circle) => {
    const { width, height } = element, data = element.getContext('2d').getImageData(0, 0, width, height).data;
    let covered = 0;
    for (let i = 0; i < 64; i++) {
      const a = i / 64 * Math.PI * 2;
      const x = Math.round(width * (circle.cx + circle.rx * Math.cos(a)));
      const y = Math.round(width * (circle.cy + circle.ry * Math.sin(a)));
      let red = false;
      for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
        if (x + dx < 0 || x + dx >= width || y + dy < 0 || y + dy >= height) continue;
        const n = ((y + dy) * width + x + dx) * 4;
        if (data[n] > 180 && data[n + 1] < 90 && data[n + 2] < 110) red = true;
      }
      if (red) covered++;
    }
    return covered;
  }, circle);
  assert.ok(coverage >= 60, `Closed red circle: only ${coverage}/64 points rendered`);
}
