import { useEffect, useState } from "react";
import { CircleHelp, Square, Volume2 } from "lucide-react";

import {
  type TtsErrorDetails,
  type TtsStyle,
  TTS_STYLE_OPTIONS,
  isSpeechSynthesisSupported,
  speakText,
  stopSpeech,
} from "../chat/tts.ts";
import { Button, InputCheckbox, InputSelect, Modal } from "../theme";
import cn from "../utils/classnames.ts";

interface SettingsHeaderProps {
  className?: string;
  voiceResponseDelayMs: number | null;
  onVoiceResponseDelayChange: (delayMs: number | null) => void;
  ttsAutoplay: boolean;
  onTtsAutoplayChange: (enabled: boolean) => void;
  ttsStyle: TtsStyle;
  onTtsStyleChange: (style: TtsStyle) => void;
  ttsVoiceUri: string;
  onTtsVoiceUriChange: (voiceUri: string) => void;
}

const voiceResponseDelayOptions = [
  { value: "manual", label: "Manual" },
  { value: "500", label: "0.5s" },
  { value: "1000", label: "1.0s" },
  { value: "1500", label: "1.5s" },
  { value: "2500", label: "2.5s" },
  { value: "4000", label: "4.0s" },
  { value: "6000", label: "6.0s" },
];

const TEST_VOICE_SAMPLE =
  "Ciao. Questa e una prova vocale del browser assistant. Se senti questa frase, la sintesi vocale sta funzionando.";

export default function SettingsHeader({
  className = "",
  voiceResponseDelayMs,
  onVoiceResponseDelayChange,
  ttsAutoplay,
  onTtsAutoplayChange,
  ttsStyle,
  onTtsStyleChange,
  ttsVoiceUri,
  onTtsVoiceUriChange,
}: SettingsHeaderProps) {
  const [voiceOptions, setVoiceOptions] = useState<
    Array<{ value: string; label: string }>
  >([{ value: "", label: "Browser default" }]);
  const [isTestingVoice, setIsTestingVoice] = useState(false);
  const [ttsTestError, setTtsTestError] = useState<string | null>(null);
  const [ttsTestErrorDetails, setTtsTestErrorDetails] =
    useState<TtsErrorDetails | null>(null);
  const [isTtsTestModalOpen, setIsTtsTestModalOpen] = useState(false);

  useEffect(() => {
    const updateVoiceOptions = () => {
      const availableVoices = window.speechSynthesis?.getVoices() || [];
      const nextOptions = [
        { value: "", label: "Browser default" },
        ...availableVoices.map((voice) => ({
          value: voice.voiceURI,
          label: `${voice.name} (${voice.lang})`,
        })),
      ];

      setVoiceOptions(nextOptions);
    };

    updateVoiceOptions();
    window.speechSynthesis?.addEventListener("voiceschanged", updateVoiceOptions);

    return () => {
      window.speechSynthesis?.removeEventListener(
        "voiceschanged",
        updateVoiceOptions
      );
    };
  }, []);

  useEffect(() => {
    return () => {
      stopSpeech();
    };
  }, []);

  const handleTestVoice = () => {
    if (!isSpeechSynthesisSupported()) {
      setTtsTestError("Speech synthesis is not supported in this browser.");
      setTtsTestErrorDetails(null);
      return;
    }

    if (isTestingVoice) {
      stopSpeech();
      setIsTestingVoice(false);
      return;
    }

    speakText({
      text: TEST_VOICE_SAMPLE,
      style: ttsStyle,
      voiceUri: ttsVoiceUri,
      preferImmediateStart: true,
      onStart: () => {
        setIsTestingVoice(true);
        setTtsTestError(null);
        setTtsTestErrorDetails(null);
      },
      onEnd: () => {
        setIsTestingVoice(false);
      },
      onError: (message, details) => {
        setIsTestingVoice(false);
        setTtsTestError(message);
        setTtsTestErrorDetails(details);
      },
    });
  };

  return (
    <header
      className={cn(
        className,
        "border-b border-chrome-border bg-chrome-bg-primary px-6 py-4"
      )}
    >
      <div className="flex flex-col gap-4">
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
        <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
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
          <InputCheckbox
            id="tts-autoplay"
            label="Speak replies"
            checked={ttsAutoplay}
            onChange={(event) => onTtsAutoplayChange(event.target.checked)}
            description="Automatically read the latest assistant reply aloud."
            tooltip="Uses the browser speech synthesis engine locally in the sidebar."
          />
          <InputSelect
            id="tts-style"
            label="Speech style"
            value={ttsStyle}
            options={TTS_STYLE_OPTIONS}
            onChange={(event) => onTtsStyleChange(event.target.value as TtsStyle)}
            tooltip="Controls speaking rate, pitch, and pause pacing for a more expressive voice."
          />
          <InputSelect
            id="tts-voice"
            label="Voice"
            value={ttsVoiceUri}
            options={voiceOptions}
            onChange={(event) => onTtsVoiceUriChange(event.target.value)}
            tooltip="Choose which browser voice is used for spoken responses."
          />
          <div className="flex flex-col justify-end gap-2">
            <Button
              type="button"
              size="sm"
              color={isTestingVoice ? "danger" : "secondary"}
              variant="solid"
              iconLeft={isTestingVoice ? <Square /> : <Volume2 />}
              onClick={handleTestVoice}
            >
              {isTestingVoice ? "Stop voice" : "Test voice"}
            </Button>
            {ttsTestError && (
              <div className="flex items-center gap-2 text-xs text-chrome-text-secondary">
                <p className="truncate">{ttsTestError}</p>
                {ttsTestErrorDetails && (
                  <Button
                    type="button"
                    size="xs"
                    color="mono"
                    variant="ghost"
                    iconLeft={<CircleHelp />}
                    onClick={() => setIsTtsTestModalOpen(true)}
                  >
                    ?
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
      {isTtsTestModalOpen && ttsTestErrorDetails && (
        <Modal
          title="Test voice error"
          onClose={() => setIsTtsTestModalOpen(false)}
          className="max-w-2xl"
        >
          <div className="space-y-4 text-sm text-chrome-text-primary">
            <p>{ttsTestErrorDetails.message}</p>
            <div className="grid grid-cols-2 gap-3 text-xs text-chrome-text-secondary">
              <div>
                <strong className="text-chrome-text-primary">Code:</strong> {ttsTestErrorDetails.code}
              </div>
              <div>
                <strong className="text-chrome-text-primary">Stage:</strong> {ttsTestErrorDetails.stage}
              </div>
              <div>
                <strong className="text-chrome-text-primary">Chunk:</strong> {ttsTestErrorDetails.chunkIndex}/{ttsTestErrorDetails.totalChunks}
              </div>
              <div>
                <strong className="text-chrome-text-primary">Retry:</strong> {ttsTestErrorDetails.retryCount}
              </div>
              <div>
                <strong className="text-chrome-text-primary">Voice:</strong> {ttsTestErrorDetails.voiceName}
              </div>
              <div>
                <strong className="text-chrome-text-primary">Lang:</strong> {ttsTestErrorDetails.lang}
              </div>
              <div>
                <strong className="text-chrome-text-primary">Voice URI:</strong> {ttsTestErrorDetails.voiceUri || "(browser default)"}
              </div>
              <div>
                <strong className="text-chrome-text-primary">At:</strong> {ttsTestErrorDetails.timestamp}
              </div>
            </div>
            <div className="rounded border border-chrome-border bg-chrome-bg-secondary p-3 text-xs text-chrome-text-secondary">
              <p className="mb-2 font-medium text-chrome-text-primary">Speech engine state</p>
              <pre className="overflow-x-auto whitespace-pre-wrap">{JSON.stringify(ttsTestErrorDetails.synthState, null, 2)}</pre>
            </div>
            <div className="rounded border border-chrome-border bg-chrome-bg-secondary p-3 text-xs text-chrome-text-secondary">
              <p className="mb-2 font-medium text-chrome-text-primary">Current chunk</p>
              <pre className="overflow-x-auto whitespace-pre-wrap">{ttsTestErrorDetails.chunk || "(empty)"}</pre>
            </div>
          </div>
        </Modal>
      )}
    </header>
  );
}
