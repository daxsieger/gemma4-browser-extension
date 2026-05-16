import { Play, Square } from "lucide-react";
import showdown from "showdown";

import { type AgentMetrics, type ChatMessageTool } from "../../shared/types.ts";
import { Button, Loader } from "../theme";
import MessageToolCall from "./MessageToolCall.tsx";

const converter = new showdown.Converter();

export default function MessageContent({
  content,
  tools = [],
  metrics,
  canSpeak = false,
  isSpeaking = false,
  onToggleSpeech,
}: {
  content: string;
  tools: Array<ChatMessageTool>;
  metrics: AgentMetrics;
  canSpeak?: boolean;
  isSpeaking?: boolean;
  onToggleSpeech?: () => void;
}) {
  const showMetrics = metrics.tokensPerSecond > 0;

  return (
    <div className="space-y-3">
      {tools && tools.length > 0 && <MessageToolCall tools={tools} />}
      {Boolean(content) ? (
        <>
          {(showMetrics || canSpeak) && (
            <div className="flex items-center justify-between gap-3">
              <div className="text-[10px] text-chrome-text-secondary">
                {showMetrics ? `${metrics.tokensPerSecond.toFixed(2)} tok/s` : ""}
              </div>
              {canSpeak && onToggleSpeech && (
                <Button
                  type="button"
                  size="xs"
                  color={isSpeaking ? "danger" : "secondary"}
                  variant="solid"
                  iconLeft={isSpeaking ? <Square /> : <Play />}
                  onClick={onToggleSpeech}
                >
                  {isSpeaking ? "Stop" : "Play"}
                </Button>
              )}
            </div>
          )}
          <div
            className="prose prose-invert prose-li:text-sm prose-headings:text-sm prose-p:text-sm prose-headings:font-semibold prose-p:my-2 prose-ul:my-2 prose-li:my-0 prose-hr:my-4 max-w-none break-words overflow-wrap-anywhere"
            dangerouslySetInnerHTML={{
              __html: converter.makeHtml(content),
            }}
          />
        </>
      ) : (
        <p className="flex items-center gap-3">
          <Loader size="sm" /> loading..
        </p>
      )}
    </div>
  );
}
