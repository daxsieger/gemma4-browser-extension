export type TtsStyle = "natural" | "expressive" | "calm" | "narrator";

export interface TtsErrorDetails {
  message: string;
  code: string;
  stage: "preflight" | "start-watchdog" | "utterance-error";
  chunk: string;
  chunkIndex: number;
  totalChunks: number;
  retryCount: number;
  voiceUri: string;
  voiceName: string;
  lang: string;
  synthState: {
    speaking: boolean;
    pending: boolean;
    paused: boolean;
    voiceCount: number;
  };
  timestamp: string;
}

interface SpeechChunkOptions {
  includeIncompleteTail?: boolean;
}

export const TTS_STYLE_OPTIONS: Array<{ value: TtsStyle; label: string }> = [
  { value: "natural", label: "Natural" },
  { value: "expressive", label: "Expressive" },
  { value: "calm", label: "Calm" },
  { value: "narrator", label: "Narrator" },
];

export const isTtsStyle = (value: string): value is TtsStyle =>
  TTS_STYLE_OPTIONS.some((option) => option.value === value);

const TTS_STYLE_CONFIG: Record<
  TtsStyle,
  { pitch: number; rate: number; volume: number; pauseMs: number }
> = {
  natural: {
    pitch: 1,
    rate: 1,
    volume: 1,
    pauseMs: 180,
  },
  expressive: {
    pitch: 1.18,
    rate: 1.02,
    volume: 1,
    pauseMs: 240,
  },
  calm: {
    pitch: 0.95,
    rate: 0.92,
    volume: 0.95,
    pauseMs: 320,
  },
  narrator: {
    pitch: 0.88,
    rate: 0.9,
    volume: 1,
    pauseMs: 360,
  },
};

let activeSpeechSessionId = 0;
let pendingSpeechTimerId: number | null = null;
let speechRecoveryRequired = false;
let keepAliveIntervalId: number | null = null;

const MAX_SPEECH_CHUNK_LENGTH = 220;
const CHUNK_WATCHDOG_MS = 8000;
const KEEP_ALIVE_INTERVAL_MS = 10000;

const startKeepAlive = () => {
  if (keepAliveIntervalId !== null || !isSpeechSynthesisSupported()) {
    return;
  }
  keepAliveIntervalId = window.setInterval(() => {
    const synth = window.speechSynthesis;
    if (synth.speaking && !synth.paused) {
      synth.pause();
      synth.resume();
    }
  }, KEEP_ALIVE_INTERVAL_MS);
};

const stopKeepAlive = () => {
  if (keepAliveIntervalId !== null) {
    window.clearInterval(keepAliveIntervalId);
    keepAliveIntervalId = null;
  }
};

const stripMarkdownForSpeech = (content: string) =>
  content
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/^[-*+]\s+/gm, "")
    .replace(/^\d+\.\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_{1,2}([^_]+)_{1,2}/g, "$1")
    .replace(/\n{2,}/g, ". ")
    .replace(/\s+/g, " ")
    .trim();

const splitLongSpeechChunk = (chunk: string) => {
  if (chunk.length <= MAX_SPEECH_CHUNK_LENGTH) {
    return [chunk];
  }

  const segments: string[] = [];
  let remainingChunk = chunk.trim();

  while (remainingChunk.length > MAX_SPEECH_CHUNK_LENGTH) {
    const slice = remainingChunk.slice(0, MAX_SPEECH_CHUNK_LENGTH + 1);
    const splitIndex = Math.max(
      slice.lastIndexOf(","),
      slice.lastIndexOf(";"),
      slice.lastIndexOf(":"),
      slice.lastIndexOf(" ")
    );

    const boundary = splitIndex > 40 ? splitIndex : MAX_SPEECH_CHUNK_LENGTH;
    segments.push(remainingChunk.slice(0, boundary).trim());
    remainingChunk = remainingChunk.slice(boundary).trim();
  }

  if (remainingChunk) {
    segments.push(remainingChunk);
  }

  return segments.filter(Boolean);
};

export const getSpeechChunks = (
  content: string,
  { includeIncompleteTail = true }: SpeechChunkOptions = {}
) => {
  const normalized = stripMarkdownForSpeech(content)
    .replace(/\s*([,;:])\s*/g, "$1 ")
    .replace(/\s*([.!?])\s*/g, "$1 ")
    .trim();

  const rawSegments = normalized.match(/[^.!?;:]+[.!?;:]?/g) || [];

  return rawSegments.flatMap((segment, index) => {
    const trimmedSegment = segment.trim();

    if (!trimmedSegment) {
      return [];
    }

    const isComplete = /[.!?;:]$/.test(trimmedSegment);
    const isTrailingSegment = index === rawSegments.length - 1;

    if (!isComplete && isTrailingSegment && !includeIncompleteTail) {
      return [];
    }

    return splitLongSpeechChunk(trimmedSegment);
  });
};

const clearPendingSpeechTimer = () => {
  if (pendingSpeechTimerId !== null) {
    window.clearTimeout(pendingSpeechTimerId);
    pendingSpeechTimerId = null;
  }
};

const getSpeechErrorMessage = (error: string) => {
  switch (error) {
    case "audio-busy":
      return "Another app is currently using the speech engine.";
    case "language-unavailable":
    case "voice-unavailable":
      return "The selected speech voice is not currently available.";
    case "not-allowed":
      return "Speech playback was blocked by the browser.";
    default:
      return "Speech playback failed.";
  }
};

const buildTtsErrorDetails = ({
  message,
  code,
  stage,
  chunk,
  chunkIndex,
  totalChunks,
  retryCount,
  voiceUri,
  voiceName,
  lang,
}: {
  message: string;
  code: string;
  stage: TtsErrorDetails["stage"];
  chunk: string;
  chunkIndex: number;
  totalChunks: number;
  retryCount: number;
  voiceUri: string;
  voiceName: string;
  lang: string;
}): TtsErrorDetails => ({
  message,
  code,
  stage,
  chunk,
  chunkIndex,
  totalChunks,
  retryCount,
  voiceUri,
  voiceName,
  lang,
  synthState: {
    speaking: window.speechSynthesis.speaking,
    pending: window.speechSynthesis.pending,
    paused: window.speechSynthesis.paused,
    voiceCount: window.speechSynthesis.getVoices().length,
  },
  timestamp: new Date().toISOString(),
});

const getSelectedVoice = (voiceUri: string) => {
  if (!voiceUri) {
    return null;
  }

  return window.speechSynthesis
    .getVoices()
    .find((voice) => voice.voiceURI === voiceUri);
};

export const isSpeechSynthesisSupported = () =>
  typeof window !== "undefined" && "speechSynthesis" in window;

export const isSpeechEngineWedged = () => {
  if (!isSpeechSynthesisSupported()) {
    return false;
  }
  const synth = window.speechSynthesis;
  return synth.speaking || synth.pending || synth.paused;
};

export const stopSpeech = () => {
  if (!isSpeechSynthesisSupported()) {
    return;
  }

  clearPendingSpeechTimer();
  stopKeepAlive();
  speechRecoveryRequired = false;
  activeSpeechSessionId += 1;
  window.speechSynthesis.resume();
  window.speechSynthesis.cancel();
};

const resetSpeechStateIfNeeded = () => {
  if (!isSpeechSynthesisSupported()) {
    return;
  }

  const synth = window.speechSynthesis;

  if (
    !speechRecoveryRequired &&
    pendingSpeechTimerId === null &&
    !synth.speaking &&
    !synth.pending &&
    !synth.paused
  ) {
    return;
  }

  stopSpeech();
};

const markSpeechEngineForRecovery = () => {
  speechRecoveryRequired = true;
  stopSpeech();
  speechRecoveryRequired = true;
};

export const speakText = ({
  text,
  style,
  voiceUri,
  preferImmediateStart = false,
  onStart,
  onEnd,
  onError,
}: {
  text: string;
  style: TtsStyle;
  voiceUri: string;
  preferImmediateStart?: boolean;
  onStart?: () => void;
  onEnd?: () => void;
  onError?: (message: string, details: TtsErrorDetails) => void;
}) => {
  if (!isSpeechSynthesisSupported()) {
    onError?.(
      "Speech synthesis is not supported in this browser.",
      {
        message: "Speech synthesis is not supported in this browser.",
        code: "unsupported",
        stage: "preflight",
        chunk: "",
        chunkIndex: 0,
        totalChunks: 0,
        retryCount: 0,
        voiceUri,
        voiceName: "",
        lang: navigator.language || "en-US",
        synthState: {
          speaking: false,
          pending: false,
          paused: false,
          voiceCount: 0,
        },
        timestamp: new Date().toISOString(),
      }
    );
    return;
  }

  const chunks = getSpeechChunks(text, { includeIncompleteTail: true });

  if (chunks.length === 0) {
    onError?.(
      "There is no readable text to speak.",
      buildTtsErrorDetails({
        message: "There is no readable text to speak.",
        code: "empty-text",
        stage: "preflight",
        chunk: "",
        chunkIndex: 0,
        totalChunks: 0,
        retryCount: 0,
        voiceUri,
        voiceName: getSelectedVoice(voiceUri)?.name || "",
        lang: navigator.language || "en-US",
      })
    );
    return;
  }

  const synth = window.speechSynthesis;
  resetSpeechStateIfNeeded();
  activeSpeechSessionId += 1;
  const sessionId = activeSpeechSessionId;
  const selectedVoice = getSelectedVoice(voiceUri);
  const voiceName = selectedVoice?.name || "Browser default";
  const config = TTS_STYLE_CONFIG[style];
  let chunkIndex = 0;
  let finished = false;
  let chunkRetryCount = 0;
  let startWatchdogTimerId: number | null = null;

  const clearStartWatchdog = () => {
    if (startWatchdogTimerId !== null) {
      window.clearTimeout(startWatchdogTimerId);
      startWatchdogTimerId = null;
    }
  };

  const finish = () => {
    if (finished) {
      return;
    }

    clearPendingSpeechTimer();
    clearStartWatchdog();
    stopKeepAlive();
    finished = true;

    if (activeSpeechSessionId === sessionId) {
      activeSpeechSessionId += 1;
    }

    onEnd?.();
  };

  const speakNextChunk = () => {
    if (sessionId !== activeSpeechSessionId) {
      finish();
      return;
    }

    const currentChunk = chunks[chunkIndex];

    if (!currentChunk) {
      finish();
      return;
    }

    clearPendingSpeechTimer();
    clearStartWatchdog();

    const utterance = new SpeechSynthesisUtterance(currentChunk);
    utterance.rate = config.rate;
    utterance.pitch = config.pitch;
    utterance.volume = config.volume;
    if (selectedVoice) {
      utterance.voice = selectedVoice;
    }
    utterance.lang = selectedVoice?.lang || navigator.language || "en-US";

    const watchdogMs = chunkIndex === 0 ? 1500 : CHUNK_WATCHDOG_MS;
    startWatchdogTimerId = window.setTimeout(() => {
      if (sessionId !== activeSpeechSessionId || finished) {
        return;
      }

      if (chunkIndex === 0 && (synth.speaking || synth.pending)) {
        clearStartWatchdog();
        return;
      }

      const message =
        chunkIndex === 0
          ? "Speech playback did not start. Try clicking Play again or choose a different voice."
          : "Speech playback stalled. The browser speech engine may need a restart.";
      markSpeechEngineForRecovery();
      onError?.(
        message,
        buildTtsErrorDetails({
          message,
          code: chunkIndex === 0 ? "start-timeout" : "chunk-stall",
          stage: "start-watchdog",
          chunk: currentChunk,
          chunkIndex: chunkIndex + 1,
          totalChunks: chunks.length,
          retryCount: chunkRetryCount,
          voiceUri,
          voiceName,
          lang: utterance.lang,
        })
      );
      finish();
    }, watchdogMs);

    if (chunkIndex === 0) {
      onStart?.();
    }

    utterance.onstart = () => {
      clearStartWatchdog();
      startKeepAlive();
    };

    utterance.onend = () => {
      if (sessionId !== activeSpeechSessionId) {
        finish();
        return;
      }

      chunkRetryCount = 0;
      chunkIndex += 1;

      if (chunkIndex >= chunks.length) {
        finish();
        return;
      }

      pendingSpeechTimerId = window.setTimeout(speakNextChunk, config.pauseMs);
    };

    utterance.onerror = (event) => {
      if (sessionId !== activeSpeechSessionId) {
        finish();
        return;
      }

      if (event.error === "canceled" || event.error === "interrupted") {
        finish();
        return;
      }

      if (chunkRetryCount < 1) {
        chunkRetryCount += 1;
        pendingSpeechTimerId = window.setTimeout(speakNextChunk, 180);
        return;
      }

      const message = getSpeechErrorMessage(event.error);
      markSpeechEngineForRecovery();
      onError?.(
        message,
        buildTtsErrorDetails({
          message,
          code: event.error,
          stage: "utterance-error",
          chunk: currentChunk,
          chunkIndex: chunkIndex + 1,
          totalChunks: chunks.length,
          retryCount: chunkRetryCount,
          voiceUri,
          voiceName,
          lang: utterance.lang,
        })
      );
      finish();
    };

    synth.resume();
    synth.speak(utterance);
  };

  if (preferImmediateStart) {
    speakNextChunk();
    return;
  }

  pendingSpeechTimerId = window.setTimeout(speakNextChunk, 80);
};

export const queueSpeechText = ({
  text,
  style,
  voiceUri,
  onStart,
  onEnd,
  onError,
}: {
  text: string;
  style: TtsStyle;
  voiceUri: string;
  onStart?: () => void;
  onEnd?: () => void;
  onError?: (message: string, details: TtsErrorDetails) => void;
}) => {
  if (!isSpeechSynthesisSupported()) {
    onError?.(
      "Speech synthesis is not supported in this browser.",
      {
        message: "Speech synthesis is not supported in this browser.",
        code: "unsupported",
        stage: "preflight",
        chunk: "",
        chunkIndex: 0,
        totalChunks: 0,
        retryCount: 0,
        voiceUri,
        voiceName: "",
        lang: navigator.language || "en-US",
        synthState: {
          speaking: false,
          pending: false,
          paused: false,
          voiceCount: 0,
        },
        timestamp: new Date().toISOString(),
      }
    );
    return;
  }

  const chunks = getSpeechChunks(text, { includeIncompleteTail: true });

  if (chunks.length === 0) {
    return;
  }

  const synth = window.speechSynthesis;
  const shouldStartNewSession =
    speechRecoveryRequired ||
    (!synth.speaking && !synth.pending && !synth.paused);

  if (shouldStartNewSession) {
    resetSpeechStateIfNeeded();
    activeSpeechSessionId += 1;
  }

  const sessionId = activeSpeechSessionId;
  const selectedVoice = getSelectedVoice(voiceUri);
  const voiceName = selectedVoice?.name || "Browser default";
  const config = TTS_STYLE_CONFIG[style];
  let ended = false;

  if (shouldStartNewSession) {
    onStart?.();
  }

  startKeepAlive();

  chunks.forEach((chunk, index) => {
    const utterance = new SpeechSynthesisUtterance(chunk);
    utterance.rate = config.rate;
    utterance.pitch = config.pitch;
    utterance.volume = config.volume;
    if (selectedVoice) {
      utterance.voice = selectedVoice;
    }
    utterance.lang = selectedVoice?.lang || navigator.language || "en-US";

    utterance.onerror = (event) => {
      if (sessionId !== activeSpeechSessionId) {
        return;
      }

      if (event.error === "canceled" || event.error === "interrupted") {
        return;
      }

      const message = getSpeechErrorMessage(event.error);
      markSpeechEngineForRecovery();
      onError?.(
        message,
        buildTtsErrorDetails({
          message,
          code: event.error,
          stage: "utterance-error",
          chunk,
          chunkIndex: index + 1,
          totalChunks: chunks.length,
          retryCount: 0,
          voiceUri,
          voiceName,
          lang: utterance.lang,
        })
      );
    };

    utterance.onend = () => {
      if (sessionId !== activeSpeechSessionId) {
        return;
      }

      if (index !== chunks.length - 1 || ended) {
        return;
      }

      window.setTimeout(() => {
        if (
          ended ||
          sessionId !== activeSpeechSessionId ||
          synth.speaking ||
          synth.pending
        ) {
          return;
        }

        ended = true;
        stopKeepAlive();
        onEnd?.();
      }, 60);
    };

    synth.resume();
    synth.speak(utterance);
  });
};