import type { MicRecoveryGuide } from "@/lib/mic-permission";
import { FINE_PRINT, LABEL } from "@/lib/ui";

// The way out of a denied microphone permission, as an ordered list (F-63).
// Once the permission is denied the browser will never show its own dialog
// again, so a sentence pointing at "your browser settings" was a dead end;
// these are the actual clicks, one per step, for the browser the customer
// is in. Purely presentational: lib/mic-permission.ts computes the guide,
// callers pass it in, markup comes out.

interface MicRecoveryProps {
  guide: MicRecoveryGuide;
}

export default function MicRecovery({ guide }: MicRecoveryProps) {
  return (
    <div className="flex flex-col gap-2">
      <p className={LABEL}>Unblock your microphone</p>
      <ol className="flex list-decimal flex-col gap-1 pl-4 text-fine text-ink-muted">
        {guide.steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      {guide.macosNote !== null && (
        <p className={FINE_PRINT}>{guide.macosNote}</p>
      )}
    </div>
  );
}
