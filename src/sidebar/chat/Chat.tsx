import { Hammer, Mic, Square } from "lucide-react";
import { KeyboardEvent, useEffect, useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";

import { ToolName } from "../../shared/tools.ts";
import {
  BackgroundMessages,
  BackgroundTasks,
  ChatMessage,
  ResponseStatus,
} from "../../shared/types.ts";
import { Button, InputText } from "../theme";
import cn from "../utils/classnames.ts";
import ChatCommands, { ChatCommandsRef, Command } from "./ChatCommands.tsx";
import ChatToolsModal from "./ChatToolsModal.tsx";
import MessageContent from "./MessageContent.tsx";

interface FormParams {
  input: string;
}

interface SpeechRecognitionAlternative {
  transcript: string;
}

interface SpeechRecognitionResult {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionResultList {
  length: number;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionEvent extends Event {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string;
}

interface BrowserSpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  onend: ((event: Event) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
}

declare global {
  interface Window {
    SpeechRecognition?: new () => BrowserSpeechRecognition;
    webkitSpeechRecognition?: new () => BrowserSpeechRecognition;
  }
}

const mergeTranscript = (baseInput: string, transcript: string) => {
  const normalizedTranscript = transcript.trim();

  if (!normalizedTranscript) {
    return baseInput;
  }

  if (!baseInput.trim()) {
    return normalizedTranscript;
  }

  return `${baseInput.trimEnd()} ${normalizedTranscript}`;
};

const getVoiceErrorMessage = (error: string) => {
  switch (error) {
    case "audio-capture":
      return "Microphone access is blocked.";
    case "not-allowed":
      return "Microphone permission was denied.";
    case "no-speech":
      return "No speech detected.";
    default:
      return "Voice input is currently unavailable.";
  }
};

interface ChatProps {
  voiceResponseDelayMs: number | null;
}

const getVoiceProgressClassName = (voiceResponseDelayMs: number | null) => {
  switch (voiceResponseDelayMs) {
    case 1500:
      return "voice-response-progress-1500";
    case 4000:
      return "voice-response-progress-4000";
    case 6000:
      return "voice-response-progress-6000";
    default:
      return "voice-response-progress-2500";
  }
};

export default function Chat({ voiceResponseDelayMs }: ChatProps) {
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const commandsRef = useRef<ChatCommandsRef>(null);
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const microphoneStreamRef = useRef<MediaStream | null>(null);
  const voiceSubmitTimeoutRef = useRef<number | null>(null);
  const voiceCountdownIntervalRef = useRef<number | null>(null);
  const recognitionRestartTimeoutRef = useRef<number | null>(null);
  const desiredListeningRef = useRef<boolean>(false);
  const activeRequestIdRef = useRef<number>(0);
  const voiceRecognitionBaselineRef = useRef<string>("");
  const latestRecognitionTranscriptRef = useRef<string>("");
  const voiceInputBaseRef = useRef<string>("");
  const {
    control,
    formState: { errors },
    getValues,
    handleSubmit,
    reset,
    setValue,
    watch,
  } = useForm<FormParams>({
    defaultValues: {
      input: "",
    },
  });
  const [messages, setMessages] = useState<Array<ChatMessage>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [showCommands, setShowCommands] = useState<boolean>(false);
  const [toolsOpen, setToolsOpen] = useState<boolean>(false);
  const [isListening, setIsListening] = useState<boolean>(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [voiceCountdownMs, setVoiceCountdownMs] = useState<number | null>(null);
  const [voiceCountdownRun, setVoiceCountdownRun] = useState<number>(0);

  const [activeTools, setActiveTools] = useState<ToolName[]>();
  const [toolsLoaded, setToolsLoaded] = useState<boolean>(false);

  const inputValue = watch("input");
  const isVoiceSupported = !!(
    window.SpeechRecognition || window.webkitSpeechRecognition
  );

  useEffect(() => {
    chrome.storage.local.get(["activeTools"], (result) => {
      if (result.activeTools && Array.isArray(result.activeTools)) {
        setActiveTools(result.activeTools as ToolName[]);
      }
      setToolsLoaded(true);
    });
  }, []);

  useEffect(() => {
    if (toolsLoaded) {
      chrome.storage.local.set({ activeTools });
    }
  }, [activeTools, toolsLoaded]);

  const scrollToBottom = () => {
    if (messagesContainerRef.current) {
      messagesContainerRef.current.scrollTop =
        messagesContainerRef.current.scrollHeight;
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const commands: Command[] = [
    {
      name: "/clear",
      description: "Clear message history",
      action: () => {
        chrome.runtime.sendMessage({
          type: BackgroundTasks.AGENT_CLEAR,
        });
        setMessages([]);
        setValue("input", "");
        setShowCommands(false);
      },
    },
  ];

  useEffect(() => {
    if (inputValue.startsWith("/")) {
      setShowCommands(true);
    } else {
      setShowCommands(false);
    }
  }, [inputValue]);

  const clearVoiceCountdown = () => {
    if (voiceSubmitTimeoutRef.current !== null) {
      window.clearTimeout(voiceSubmitTimeoutRef.current);
      voiceSubmitTimeoutRef.current = null;
    }

    if (voiceCountdownIntervalRef.current !== null) {
      window.clearInterval(voiceCountdownIntervalRef.current);
      voiceCountdownIntervalRef.current = null;
    }

    setVoiceCountdownMs(null);
  };

  const clearRecognitionRestart = () => {
    if (recognitionRestartTimeoutRef.current !== null) {
      window.clearTimeout(recognitionRestartTimeoutRef.current);
      recognitionRestartTimeoutRef.current = null;
    }
  };

  const startRecognitionSession = async () => {
    if (!recognitionRef.current) {
      return;
    }

    clearRecognitionRestart();

    try {
      recognitionRef.current.start();
      setIsListening(true);
      setVoiceError(null);
    } catch {
      recognitionRestartTimeoutRef.current = window.setTimeout(() => {
        void startRecognitionSession();
      }, 300);
    }
  };

  const clearVoiceSegment = () => {
    clearVoiceCountdown();
    voiceInputBaseRef.current = "";
    voiceRecognitionBaselineRef.current = latestRecognitionTranscriptRef.current;
    setValue("input", "", {
      shouldDirty: true,
      shouldValidate: true,
    });
  };

  const stopVoiceCapture = () => {
    clearVoiceCountdown();
    clearRecognitionRestart();
    desiredListeningRef.current = false;
    activeRequestIdRef.current += 1;
    voiceRecognitionBaselineRef.current = "";
    latestRecognitionTranscriptRef.current = "";
    microphoneStreamRef.current?.getTracks().forEach((track) => track.stop());
    microphoneStreamRef.current = null;
    recognitionRef.current?.stop();
  };

  const classifyVoiceStopIntent = async (prompt: string) => {
    const previousAssistantMessage = [...messages]
      .reverse()
      .find((message) => message.role === "assistant");

    return new Promise<boolean>((resolve) => {
      chrome.runtime.sendMessage(
        {
          type: BackgroundTasks.VOICE_CLASSIFY_INTENT,
          prompt,
          assistantContext: previousAssistantMessage?.content || "",
        },
        (resp) => {
          if (!resp || resp.status === ResponseStatus.ERROR) {
            resolve(false);
            return;
          }

          resolve(Boolean(resp.result?.shouldStopListening));
        }
      );
    });
  };

  const submitPrompt = (
    prompt: string,
    options: { keepListening?: boolean } = {}
  ) => {
    const normalizedPrompt = prompt.trim();

    if (!normalizedPrompt) {
      return;
    }

    void (async () => {
      const shouldStopAfterSubmit = options.keepListening
        ? await classifyVoiceStopIntent(normalizedPrompt)
        : true;

      if (options.keepListening) {
        if (shouldStopAfterSubmit) {
          stopVoiceCapture();
          reset();
        } else {
          clearVoiceSegment();
        }
      } else {
        stopVoiceCapture();
        reset();
      }

      const requestId = activeRequestIdRef.current + 1;
      activeRequestIdRef.current = requestId;
      setIsLoading(true);
      setVoiceError(null);

      inputRef.current?.focus();

      chrome.runtime.sendMessage(
        {
          type: BackgroundTasks.AGENT_GENERATE_TEXT,
          prompt: normalizedPrompt,
        },
        (resp) => {
          if (requestId !== activeRequestIdRef.current) {
            return;
          }

          if (resp.status === ResponseStatus.ERROR) {
            alert(resp.error);
          }
          setIsLoading(false);
        }
      );
    })();
  };

  const startVoiceCountdown = () => {
    if (!voiceResponseDelayMs) {
      return;
    }

    clearVoiceCountdown();

    const deadline = Date.now() + voiceResponseDelayMs;
    setVoiceCountdownMs(voiceResponseDelayMs);
    setVoiceCountdownRun((currentRun) => currentRun + 1);

    voiceCountdownIntervalRef.current = window.setInterval(() => {
      const remainingMs = Math.max(0, deadline - Date.now());
      setVoiceCountdownMs(remainingMs);
    }, 100);

    voiceSubmitTimeoutRef.current = window.setTimeout(() => {
      clearVoiceCountdown();

      const pendingPrompt = getValues("input").trim();

      if (!pendingPrompt || pendingPrompt.startsWith("/")) {
        return;
      }

      submitPrompt(pendingPrompt, { keepListening: true });
    }, voiceResponseDelayMs);
  };

  useEffect(() => {
    chrome.runtime.sendMessage(
      {
        type: BackgroundTasks.AGENT_GET_MESSAGES,
      },
      (resp) => {
        setMessages(resp.messages);
      }
    );

    chrome.runtime.sendMessage({
      type: BackgroundTasks.AGENT_CLEAR,
    });

    chrome.runtime.onMessage.addListener((message) => {
      if (message.type === BackgroundMessages.MESSAGES_UPDATE) {
        setMessages(message.messages);
      }
    });
  }, []);

  useEffect(() => {
    const SpeechRecognitionApi =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognitionApi) {
      return;
    }

    const recognition = new SpeechRecognitionApi();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = navigator.language || "en-US";
    recognition.onresult = (event) => {
      const transcript = Array.from(
        { length: event.results.length },
        (_, index) => {
          const result = event.results[index];

          return result[0]?.transcript ?? "";
        }
      ).join("");

      latestRecognitionTranscriptRef.current = transcript;

      const segmentTranscript = transcript.startsWith(
        voiceRecognitionBaselineRef.current
      )
        ? transcript.slice(voiceRecognitionBaselineRef.current.length)
        : transcript;

      const mergedTranscript = mergeTranscript(
        voiceInputBaseRef.current,
        segmentTranscript
      );

      setValue("input", mergedTranscript, {
        shouldDirty: true,
        shouldValidate: true,
      });

      if (mergedTranscript.trim()) {
        startVoiceCountdown();
      }
    };
    recognition.onerror = (event) => {
      clearVoiceCountdown();
      if (event.error === "not-allowed" || event.error === "audio-capture") {
        desiredListeningRef.current = false;
      }
      setVoiceError(getVoiceErrorMessage(event.error));
    };
    recognition.onend = () => {
      clearVoiceCountdown();

      if (desiredListeningRef.current) {
        void startRecognitionSession();
        return;
      }

      setIsListening(false);
    };

    recognitionRef.current = recognition;

    return () => {
      clearVoiceCountdown();
      clearRecognitionRestart();
      desiredListeningRef.current = false;
      voiceRecognitionBaselineRef.current = "";
      latestRecognitionTranscriptRef.current = "";
      microphoneStreamRef.current?.getTracks().forEach((track) => track.stop());
      microphoneStreamRef.current = null;
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      recognition.stop();
      recognitionRef.current = null;
    };
  }, [getValues, reset, setValue, voiceResponseDelayMs]);

  // Forward keyboard events to ChatCommands
  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    commandsRef.current?.handleKeyDown(e);
  };

  const requestMicrophoneAccess = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("UNSUPPORTED_MEDIA_DEVICES");
    }

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

    microphoneStreamRef.current?.getTracks().forEach((track) => track.stop());
    microphoneStreamRef.current = stream;
  };

  const toggleVoiceInput = async () => {
    if (!recognitionRef.current) {
      setVoiceError("Voice input is not supported in this browser.");
      return;
    }

    if (isListening) {
      stopVoiceCapture();
      setIsListening(false);
      return;
    }

    try {
      voiceInputBaseRef.current = getValues("input") || "";
      voiceRecognitionBaselineRef.current = "";
      latestRecognitionTranscriptRef.current = "";
      desiredListeningRef.current = true;
      setVoiceError(null);
      await requestMicrophoneAccess();
      await startRecognitionSession();
    } catch (error) {
      desiredListeningRef.current = false;
      if (error instanceof DOMException) {
        if (error.name === "NotAllowedError") {
          setVoiceError("Microphone permission was denied. Check the browser permission for this extension.");
          return;
        }

        if (error.name === "NotFoundError") {
          setVoiceError("No microphone was found on this device.");
          return;
        }

        if (error.name === "NotReadableError") {
          setVoiceError("The microphone is already in use by another app or blocked by the OS.");
          return;
        }
      }

      if (error instanceof Error && error.message === "UNSUPPORTED_MEDIA_DEVICES") {
        setVoiceError("This browser cannot request microphone access from the extension panel.");
        return;
      }

      setVoiceError("Voice input is already active or unavailable.");
    }
  };

  const onSubmit = (data: FormParams) => {
    submitPrompt(data.input, { keepListening: isListening });
  };

  return (
    <div className="flex flex-col h-full">
      <div
        ref={messagesContainerRef}
        className="flex-1 overflow-y-auto px-6 py-4 space-y-4"
      >
        {(messages || []).length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-sm text-chrome-text-secondary">
              Start a conversation by typing a message below
            </p>
          </div>
        ) : (
          messages.map((message, index) => (
            <div
              key={index}
              className={cn(
                "max-w-[85%] rounded-md px-4 py-3",
                message.role === "user"
                  ? "ml-auto bg-chrome-accent-primary text-chrome-bg-primary"
                  : "bg-chrome-bg-secondary"
              )}
            >
              <div className="text-sm">
                {message.role === "user" ? (
                  message.content
                ) : (
                  <MessageContent
                    content={message.content}
                    tools={message.tools}
                    metrics={message.metrics}
                  />
                )}
              </div>
            </div>
          ))
        )}
      </div>

      <div className="border-t border-chrome-border px-6 py-4 bg-chrome-bg-secondary relative">
        <ChatCommands
          ref={commandsRef}
          commands={commands}
          inputValue={inputValue}
          isOpen={showCommands}
          onClose={() => setShowCommands(false)}
          onExecute={() => setShowCommands(false)}
        />
        {toolsOpen && (
          <ChatToolsModal
            activeTools={activeTools}
            onClose={() => setToolsOpen(false)}
            onSubmit={(tools: ToolName[]) => {
              setActiveTools(tools);
              setToolsOpen(false);
            }}
          />
        )}
        <div className="flex flex-col gap-2">
          <form onSubmit={handleSubmit(onSubmit)} className="flex gap-3">
            <Button
              type="button"
              color="secondary"
              variant="solid"
              iconLeft={<Hammer />}
              onClick={() => setToolsOpen(true)}
            />
            <Controller
              name="input"
              control={control}
              rules={{ required: "Message is required" }}
              render={({ field }) => (
                <InputText
                  {...field}
                  id="chat-input"
                  label="Message"
                  placeholder="Type your message, speak, or / for commands..."
                  error={errors.input?.message}
                  hideLabel
                  className="flex-1"
                  onKeyDown={handleKeyDown}
                  ref={(e) => {
                    field.ref(e);
                    (inputRef as any).current = e;
                  }}
                />
              )}
            />
            <button
              type="button"
              onClick={toggleVoiceInput}
              disabled={!isVoiceSupported}
              aria-label={isListening ? "Stop voice input" : "Start voice input"}
              className={cn(
                "inline-flex items-center justify-center rounded p-2 transition-colors focus:outline-none focus:ring-2 focus:ring-chrome-accent-primary focus:ring-offset-2 focus:ring-offset-chrome-bg-primary disabled:cursor-not-allowed disabled:opacity-50",
                isListening
                  ? "bg-red-500 text-white hover:bg-red-600"
                  : "bg-chrome-bg-tertiary text-chrome-text-primary hover:bg-chrome-hover"
              )}
            >
              {isListening ? (
                <Square className="h-5 w-5" />
              ) : (
                <Mic className="h-5 w-5" />
              )}
            </button>
            <Button
              type="submit"
              disabled={isLoading || showCommands}
              color="primary"
              variant="solid"
            >
              Send
            </Button>
          </form>
          {isListening && voiceCountdownMs !== null && inputValue.trim() && !showCommands && voiceResponseDelayMs !== null && (
            <div className="flex flex-col gap-1">
              <div className="h-1.5 overflow-hidden rounded-full bg-chrome-bg-tertiary">
                <div
                  key={voiceCountdownRun}
                  className={cn(
                    "h-full rounded-full bg-chrome-accent-primary",
                    getVoiceProgressClassName(voiceResponseDelayMs)
                  )}
                />
              </div>
              <p className="text-xs text-chrome-text-secondary">
                Responding in {(voiceCountdownMs / 1000).toFixed(1)}s if you stop speaking.
              </p>
            </div>
          )}
          {(voiceError || isListening) && (
            <p className="text-xs text-chrome-text-secondary">
              {voiceError || (voiceResponseDelayMs === null
                ? "Listening... click Send when you are ready."
                : "Listening... pause briefly to send the message automatically.")}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
