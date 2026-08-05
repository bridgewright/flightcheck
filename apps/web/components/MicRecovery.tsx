import type {
  DeniedScope,
  MicRecoveryGuide,
  SystemSettingsLink,
} from "@/lib/mic-permission";
import {
  ASK_AGAIN_LINE,
  SYSTEM_SETTINGS_FALLBACK_LINE,
  SYSTEM_SETTINGS_RETURN_LINE,
} from "@/lib/mic-permission";
import { FINE_PRINT, LABEL, SECONDARY_BUTTON } from "@/lib/ui";

// The way out of a denied microphone permission (F-63), shaped by where the
// block actually lives. A page cannot open the browser's own permission UI,
// so the "site" scope gets the actual clicks, one per step, for the browser
// the customer is in; the "system" scope gets a real door, the OS URL
// scheme that opens the microphone pane itself; and "ask-again" needs no
// recovery at all, because the next attempt re-asks on its own. Purely
// presentational: lib/mic-permission.ts computes everything, callers pass
// it in, markup comes out.

interface MicRecoveryProps {
  guide: MicRecoveryGuide;
  scope: DeniedScope;
  settings: SystemSettingsLink | null;
}

export default function MicRecovery({ guide, scope, settings }: MicRecoveryProps) {
  if (scope === "ask-again") {
    return <p className={FINE_PRINT}>{ASK_AGAIN_LINE}</p>;
  }
  if (scope === "system") {
    return (
      <div className="flex flex-col gap-2">
        <p className={LABEL}>Unblock your microphone</p>
        {settings !== null ? (
          <a href={settings.href} className={`${SECONDARY_BUTTON} self-start`}>
            {settings.label}
          </a>
        ) : (
          <p className="text-fine text-ink-muted">{SYSTEM_SETTINGS_FALLBACK_LINE}</p>
        )}
        <p className={FINE_PRINT}>{SYSTEM_SETTINGS_RETURN_LINE}</p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <p className={LABEL}>Unblock your microphone</p>
      <ol className="flex list-decimal flex-col gap-1 pl-4 text-fine text-ink-muted">
        {guide.steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      {scope === "unknown" && guide.macosNote !== null && (
        <p className={FINE_PRINT}>{guide.macosNote}</p>
      )}
    </div>
  );
}
