/** Serializable: executed in the isolated review browser, without application state. */
export function findLowContrastText(rootSelector: string) {
  type Color = [number, number, number, number];
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
  const context = canvas.getContext('2d', {willReadFrequently: true});
  const cache = new Map<string, Color>();
  const colors = { parse(value: string): Color | undefined {
    const known = cache.get(value);
    if (known) return [...known];
    const match = value.match(/^rgba?\(([^)]+)\)$/);
    let color: Color;
    if (match) {
      const values = match[1].split(/[\s,/]+/).map(Number);
      if (values.length < 3 || values.some(value => !Number.isFinite(value))) return;
      color = [values[0], values[1], values[2], values[3] ?? 1];
    } else {
      // Chromium serializes color-mix and modern color spaces without converting them to rgb().
      if (!context || !CSS.supports('color', value)) return;
      context.clearRect(0, 0, 1, 1); context.fillStyle = value; context.fillRect(0, 0, 1, 1);
      const pixel = context.getImageData(0, 0, 1, 1).data;
      color = [pixel[0], pixel[1], pixel[2], pixel[3] / 255];
    }
    cache.set(value, color);
    return [...color];
  }, over(front: Color, back: Color): Color {
    const alpha = front[3] + back[3] * (1 - front[3]);
    return [0, 1, 2].map(i => alpha ? (front[i] * front[3] + back[i] * back[3] * (1 - front[3])) / alpha : 0).concat(alpha) as Color;
  }, luminance(color: Color) { return color.slice(0, 3).reduce((sum, value, i) => {
    const s = value / 255;
    return sum + (s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4) * [.2126, .7152, .0722][i];
  }, 0); } };
  const issues: { text: string; element: string; ratio: number; minimum: number; disabled: boolean; index?: number }[] = [];
  const root = document.querySelector(rootSelector);
  if (!root) return issues;
  // Check functional controls and primary copy, including disabled controls. Decorative and muted
  // metadata are left to the visual reviewer, avoiding unrelated legacy-style false positives.
  for (const [index, node] of root.querySelectorAll<HTMLElement>('button, a.button, input:not([type=checkbox]):not([type=radio]), textarea, select, h1, h2, h3, label, .theme-sample-card > p, .theme-placeholder > strong, .theme-placeholder > p').entries()) {
    const style = getComputedStyle(node), box = node.getBoundingClientRect();
    if (!box.width || !box.height || style.visibility !== 'visible') continue;
    const text = (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement ? node.value : node.textContent)?.trim().slice(0, 80);
    if (!text) continue;
    const foreground = colors.parse(style.color);
    if (!foreground) continue;
    let background: Color = [0, 0, 0, 0], painted = foreground, uncertain = false;
    for (let element: HTMLElement | null = node; element; element = element.parentElement) {
      const s = getComputedStyle(element), color = colors.parse(s.backgroundColor);
      if (background[3] < 1 && s.backgroundImage !== 'none' || s.filter !== 'none' || s.mixBlendMode !== 'normal') uncertain = true;
      if (color) { background = colors.over(background, color); painted = colors.over(painted, color); }
      const opacity = Number(s.opacity);
      background[3] *= opacity; painted[3] *= opacity;
    }
    // Images and gradients require pixel review; do not infer their background from CSS color.
    if (uncertain) continue;
    background = colors.over(background, [255, 255, 255, 1]); painted = colors.over(painted, [255, 255, 255, 1]);
    const levels = [colors.luminance(painted), colors.luminance(background)].sort((a, b) => b - a);
    const ratio = (levels[0] + .05) / (levels[1] + .05);
    const size = parseFloat(style.fontSize), weight = parseFloat(style.fontWeight) || 400;
    const minimum = size >= 24 || size >= 18.66 && weight >= 700 ? 3 : 4.5;
    if (ratio + .01 < minimum) issues.push({text, element: node.tagName.toLowerCase() + (node.classList.contains('primary') ? '.primary' : ''), ratio: Math.round(ratio * 100) / 100, minimum, disabled: node.matches(':disabled'), index});
  }
  return issues;
}
