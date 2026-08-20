import type { Meta, StoryObj } from "@storybook/react-vite";
import { CheckCircle2, CircleDashed } from "lucide-react";
import { MANUAL_CAPTURES, coveredManualCaptureCount } from "./manual-capture-manifest";

function CaptureCoverage() {
  return (
    <main className="min-h-screen bg-gray-50 p-8 text-gray-900">
      <div className="mx-auto max-w-5xl">
        <h1 className="text-2xl font-bold">Manual capture coverage</h1>
        <p className="mt-2 text-sm text-gray-500">{coveredManualCaptureCount} / {MANUAL_CAPTURES.length} captures have a deterministic Story.</p>
        <div className="mt-6 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {MANUAL_CAPTURES.map((capture) => (
            <article key={capture.fileName} className={`rounded-lg border p-3 ${capture.storyId ? "border-green-200 bg-green-50" : "border-gray-200 bg-white"}`}>
              <div className="flex items-start gap-2">
                {capture.storyId ? <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-green-600" /> : <CircleDashed size={16} className="mt-0.5 shrink-0 text-gray-400" />}
                <div className="min-w-0"><strong className="block truncate text-sm">{capture.fileName}</strong><span className="text-xs text-gray-500">{capture.chapter}</span>{capture.storyId && <code className="mt-1 block truncate text-[10px] text-green-700">{capture.storyId}</code>}</div>
              </div>
            </article>
          ))}
        </div>
      </div>
    </main>
  );
}

const meta = { title: "Manual/Capture Coverage", component: CaptureCoverage, parameters: { layout: "fullscreen" } } satisfies Meta<typeof CaptureCoverage>;
export default meta;
type Story = StoryObj<typeof meta>;
export const AllCaptures: Story = {};
