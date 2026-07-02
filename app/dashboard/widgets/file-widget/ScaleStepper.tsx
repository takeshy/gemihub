// Small −/+ percentage stepper used for PDF zoom and EPUB/HTML font & width
// adjustments (File widget header and the IDE EPUB viewer).

import { Minus, Plus } from "lucide-react";

export const SCALE_STEP = 10;

export function clampScale(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function ScaleStepper({
  value,
  min,
  max,
  title,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  title: string;
  onChange: (next: number) => void;
}) {
  return (
    <div className="flex items-center gap-0.5" title={title}>
      <button
        type="button"
        className="rounded p-0.5 text-gray-500 hover:bg-gray-100 disabled:opacity-35 dark:text-gray-400 dark:hover:bg-gray-800"
        onClick={() => onChange(clampScale(value - SCALE_STEP, min, max))}
        disabled={value <= min}
      >
        <Minus size={11} />
      </button>
      <span className="w-9 text-center text-[10px] tabular-nums text-gray-500 dark:text-gray-400">{value}%</span>
      <button
        type="button"
        className="rounded p-0.5 text-gray-500 hover:bg-gray-100 disabled:opacity-35 dark:text-gray-400 dark:hover:bg-gray-800"
        onClick={() => onChange(clampScale(value + SCALE_STEP, min, max))}
        disabled={value >= max}
      >
        <Plus size={11} />
      </button>
    </div>
  );
}
