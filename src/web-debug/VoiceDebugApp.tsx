import { useEffect, useMemo, useRef, useState } from "react";

import {
  type TtsErrorDetails,
  TTS_STYLE_OPTIONS,
  type TtsStyle,
  getSpeechChunks,
  isSpeechSynthesisSupported,
  queueSpeechText,
  speakText,
  stopSpeech,
} from "../sidebar/chat/tts.ts";
import { Button, InputSelect, InputTextarea } from "../sidebar/theme";

const SAMPLE_TEXT =
  "Ciao. Questa pagina serve per fare debug della sintesi vocale fuori dall'estensione. Possiamo verificare la voce selezionata, leggere tutto il testo in un colpo, oppure simulare lo streaming accodando una frase alla volta.";

const STREAM_STEPS = [
  "Ciao.",
  "Questa pagina serve per fare debug della sintesi vocale fuori dall'estensione.",
  "Possiamo verificare la voce selezionata.",
  "Possiamo leggere tutto il testo in un colpo.",
  "Oppure simulare lo streaming accodando una frase alla volta.",
];

export default function VoiceDebugApp() {
  const [voiceUri, setVoiceUri] = useState("");
  const [ttsStyle, setTtsStyle] = useState<TtsStyle>("natural");
  const [text, setText] = useState(SAMPLE_TEXT);
  const [voiceOptions, setVoiceOptions] = useState<
    Array<{ value: string; label: string }>
  >([{ value: "", label: "Browser default" }]);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [ttsErrorDetails, setTtsErrorDetails] = useState<TtsErrorDetails | null>(null);
  const streamTimerRef = useRef<number | null>(null);

  const appendLog = (line: string) => {
    setLogLines((current) => [
      `${new Date().toLocaleTimeString()} ${line}`,
      ...current,
    ].slice(0, 40));
  };

  useEffect(() => {
    const updateVoiceOptions = () => {
      const voices = window.speechSynthesis?.getVoices() || [];
      setVoiceOptions([
        { value: "", label: "Browser default" },
        ...voices.map((voice) => ({
          value: voice.voiceURI,
          label: `${voice.name} (${voice.lang})${voice.default ? " [default]" : ""}`,
        })),
      ]);
    };

    updateVoiceOptions();
    window.speechSynthesis?.addEventListener("voiceschanged", updateVoiceOptions);

    return () => {
      window.speechSynthesis?.removeEventListener("voiceschanged", updateVoiceOptions);
      if (streamTimerRef.current !== null) {
        window.clearTimeout(streamTimerRef.current);
        streamTimerRef.current = null;
      }
      stopSpeech();
    };
  }, []);

  const speechState = useMemo(() => {
    if (!isSpeechSynthesisSupported()) {
      return {
        supported: false,
        speaking: false,
        pending: false,
        paused: false,
        voices: 0,
        chunkCount: 0,
      };
    }

    const synth = window.speechSynthesis;
    return {
      supported: true,
      speaking: synth.speaking,
      pending: synth.pending,
      paused: synth.paused,
      voices: synth.getVoices().length,
      chunkCount: getSpeechChunks(text, { includeIncompleteTail: true }).length,
    };
  }, [text, voiceOptions.length, isSpeaking, isStreaming]);

  const handleStop = () => {
    if (streamTimerRef.current !== null) {
      window.clearTimeout(streamTimerRef.current);
      streamTimerRef.current = null;
    }
    stopSpeech();
    setIsSpeaking(false);
    setIsStreaming(false);
    appendLog("Stopped speech engine");
  };

  const handleError = (message: string, details: TtsErrorDetails) => {
    setIsSpeaking(false);
    setIsStreaming(false);
    setTtsErrorDetails(details);
    appendLog(`ERROR ${details.code}: ${message}`);
  };

  const handleSpeak = () => {
    setTtsErrorDetails(null);
    speakText({
      text,
      style: ttsStyle,
      voiceUri,
      preferImmediateStart: true,
      onStart: () => {
        setIsSpeaking(true);
        appendLog("Started full speech playback");
      },
      onEnd: () => {
        setIsSpeaking(false);
        appendLog("Finished full speech playback");
      },
      onError: handleError,
    });
  };

  const handleStream = () => {
    if (streamTimerRef.current !== null) {
      window.clearTimeout(streamTimerRef.current);
      streamTimerRef.current = null;
    }

    stopSpeech();
    setIsSpeaking(false);
    setIsStreaming(true);
    setTtsErrorDetails(null);
    appendLog("Started streaming simulation");

    let index = 0;
    const pushNextChunk = () => {
      if (index >= STREAM_STEPS.length) {
        setIsStreaming(false);
        appendLog("Streaming simulation queued all chunks");
        return;
      }

      const chunk = STREAM_STEPS[index];
      index += 1;

      queueSpeechText({
        text: chunk,
        style: ttsStyle,
        voiceUri,
        onStart: () => {
          setIsSpeaking(true);
          appendLog(`Queued stream chunk ${index}/${STREAM_STEPS.length}`);
        },
        onEnd: () => {
          setIsSpeaking(window.speechSynthesis.speaking || window.speechSynthesis.pending);
        },
        onError: handleError,
      });

      streamTimerRef.current = window.setTimeout(pushNextChunk, 900);
    };

    pushNextChunk();
  };

  return (
    <main className="min-h-screen bg-chrome-bg-primary text-chrome-text-primary">
      <div className="mx-auto flex max-w-5xl flex-col gap-6 px-6 py-8">
        <header className="space-y-2">
          <h1 className="text-3xl">Gemma Voice Debug</h1>
          <p className="text-sm text-chrome-text-secondary">
            Pagina web standalone per debug della sintesi vocale senza side panel o runtime Chrome.
          </p>
        </header>

        <section className="grid gap-4 md:grid-cols-3">
          <InputSelect
            id="debug-voice"
            label="Voice"
            value={voiceUri}
            options={voiceOptions}
            onChange={(event) => setVoiceUri(event.target.value)}
          />
          <InputSelect
            id="debug-style"
            label="Speech style"
            value={ttsStyle}
            options={TTS_STYLE_OPTIONS}
            onChange={(event) => setTtsStyle(event.target.value as TtsStyle)}
          />
          <div className="rounded border border-chrome-border bg-chrome-bg-secondary px-4 py-3 text-sm">
            <p className="font-medium">Engine state</p>
            <p className="mt-2 text-chrome-text-secondary">Supported: {String(speechState.supported)}</p>
            <p className="text-chrome-text-secondary">Speaking: {String(speechState.speaking || isSpeaking)}</p>
            <p className="text-chrome-text-secondary">Pending: {String(speechState.pending)}</p>
            <p className="text-chrome-text-secondary">Paused: {String(speechState.paused)}</p>
            <p className="text-chrome-text-secondary">Voices: {speechState.voices}</p>
            <p className="text-chrome-text-secondary">Chunks: {speechState.chunkCount}</p>
          </div>
        </section>

        <InputTextarea
          id="debug-text"
          label="Text"
          rows={8}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />

        <section className="flex flex-wrap gap-3">
          <Button type="button" variant="solid" color="primary" onClick={handleSpeak}>
            Speak full text
          </Button>
          <Button type="button" variant="solid" color="secondary" onClick={handleStream}>
            Simulate streaming
          </Button>
          <Button type="button" variant="outline" color="mono" onClick={handleStop}>
            Stop and reset
          </Button>
          <Button
            type="button"
            variant="ghost"
            color="mono"
            onClick={() => {
              setLogLines([]);
              setTtsErrorDetails(null);
            }}
          >
            Clear logs
          </Button>
        </section>

        {ttsErrorDetails && (
          <section className="rounded border border-red-500/40 bg-red-950/20 p-4 text-sm">
            <p className="font-medium text-red-300">Last TTS error</p>
            <pre className="mt-3 overflow-x-auto whitespace-pre-wrap text-xs text-chrome-text-secondary">
              {JSON.stringify(ttsErrorDetails, null, 2)}
            </pre>
          </section>
        )}

        <section className="rounded border border-chrome-border bg-chrome-bg-secondary p-4">
          <p className="font-medium">Event log</p>
          <div className="mt-3 max-h-80 overflow-y-auto space-y-2 text-xs text-chrome-text-secondary">
            {logLines.length === 0 ? (
              <p>No events yet.</p>
            ) : (
              logLines.map((line) => <p key={line}>{line}</p>)
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
