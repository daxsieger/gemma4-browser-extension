import { InputSelect } from "../theme";
import cn from "../utils/classnames.ts";

interface SettingsHeaderProps {
  className?: string;
  voiceResponseDelayMs: number | null;
  onVoiceResponseDelayChange: (delayMs: number | null) => void;
}

const voiceResponseDelayOptions = [
  { value: "manual", label: "Manual" },
  { value: "1500", label: "1.5s" },
  { value: "2500", label: "2.5s" },
  { value: "4000", label: "4.0s" },
  { value: "6000", label: "6.0s" },
];

export default function SettingsHeader({
  className = "",
  voiceResponseDelayMs,
  onVoiceResponseDelayChange,
}: SettingsHeaderProps) {
  return (
    <header
      className={cn(
        className,
        "border-b border-chrome-border bg-chrome-bg-primary px-6 py-4"
      )}
    >
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-normal text-chrome-text-primary leading-tight">
            Gemma 4 Browser Assistant
          </h1>
          <p className="text-sm text-chrome-text-secondary mt-1">
            Powered by{" "}
            <a
              href="https://github.com/huggingface/transformers.js"
              target="_blank"
              className="text-chrome-accent-primary hover:text-chrome-accent-hover no-underline"
              rel="noopener noreferrer"
            >
              🤗 Transformers.js
            </a>
          </p>
        </div>
        <div className="w-32 shrink-0">
          <InputSelect
            id="voice-response-delay"
            label="Voice pause"
            value={voiceResponseDelayMs === null ? "manual" : String(voiceResponseDelayMs)}
            options={voiceResponseDelayOptions}
            onChange={(event) =>
              onVoiceResponseDelayChange(
                event.target.value === "manual"
                  ? null
                  : Number(event.target.value)
              )
            }
            tooltip="How long the assistant waits after you stop speaking before it sends the prompt automatically."
          />
        </div>
      </div>
    </header>
  );
}
