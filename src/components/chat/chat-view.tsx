"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import {
  Send,
  Square,
  Trash2,
  AlertTriangle,
  MessageSquare,
  RotateCcw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";

/**
 * Single chat message shape. Roles are constrained to the two that
 * the chat UI actually renders; the system prompt is appended server-side.
 */
export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

const EXAMPLE_PROMPTS = [
  "Explain risk-reward ratio",
  "What is the London session?",
  "How do I avoid revenge trading?",
  "What does 1 lot mean in forex?",
];

const DISCLAIMER =
  "Not financial advice. Trading forex involves substantial risk of loss.";

/**
 * ChatView - the full /chat experience.
 *
 * Features:
 *  - message bubbles (user right, assistant left) with markdown
 *  - auto-scroll to bottom on new tokens
 *  - Enter to send, Shift+Enter for newline
 *  - Stop button aborts the in-flight stream (keeps partial reply)
 *  - Clear chat button
 *  - example prompt chips shown in the empty state
 *  - friendly error messages for 429 / network / missing-key
 *  - typing indicator (three dots) before first token arrives
 *
 * All state is local; nothing is persisted (journal-style persistence
 * comes later). Refreshing the page clears the conversation.
 */
export function ChatView() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const scrollViewportRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // ---- Auto-scroll -----------------------------------------------------
  // Whenever the last message content grows (streaming) or the message
  // list changes, pin the scroll to the bottom.
  const lastContent = messages[messages.length - 1]?.content ?? "";
  useEffect(() => {
    const el = scrollViewportRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, lastContent, isLoading]);

  // ---- Auto-grow textarea ---------------------------------------------
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
  }, [input]);

  // ---- Send ------------------------------------------------------------
  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isLoading) return;

      setError(null);
      setInput("");

      const userMsg: ChatMessage = { role: "user", content: trimmed };
      const assistantMsg: ChatMessage = { role: "assistant", content: "" };

      // Snapshot the conversation we are about to send to the server.
      const historyForServer = [...messages, userMsg];

      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      setIsLoading(true);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: historyForServer }),
          signal: controller.signal,
        });

        if (!res.ok) {
          let msg: string;
          try {
            const data = await res.json();
            msg = data.error || `Request failed (${res.status})`;
          } catch {
            msg = `Request failed (${res.status})`;
          }
          throw new ChatError(msg, res.status);
        }

        if (!res.body) throw new ChatError("No response body received.", 500);

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let accumulated = "";

        // Read chunks until the stream closes.
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          accumulated += decoder.decode(value, { stream: true });
          const snapshot = accumulated;
          setMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last && last.role === "assistant") {
              next[next.length - 1] = { ...last, content: snapshot };
            }
            return next;
          });
        }

        // If the model returned nothing, surface a friendly note.
        if (!accumulated.trim()) {
          setMessages((prev) => {
            const next = [...prev];
            next[next.length - 1] = {
              role: "assistant",
              content:
                "I didn't produce a response. Please rephrase your question and try again.",
            };
            return next;
          });
        }
      } catch (err) {
        if (err instanceof ChatError && err.name === "AbortError") {
          // Shouldn't happen - we rethrow DOMException separately below.
        }
        if (err instanceof DOMException && err.name === "AbortError") {
          // User pressed Stop. Keep whatever partial reply arrived.
          // If nothing arrived, drop the empty assistant placeholder.
          setMessages((prev) => {
            if (prev.length && prev[prev.length - 1].content === "") {
              return prev.slice(0, -1);
            }
            return prev;
          });
        } else if (err instanceof ChatError) {
          setError(err.message);
          // Drop the empty assistant placeholder so the user can retry.
          setMessages((prev) => {
            if (prev.length && prev[prev.length - 1].content === "") {
              return prev.slice(0, -1);
            }
            return prev;
          });
        } else {
          // Network error, CORS, etc.
          setError(
            "Network error - couldn't reach the server. Check your connection and try again.",
          );
          setMessages((prev) => {
            if (prev.length && prev[prev.length - 1].content === "") {
              return prev.slice(0, -1);
            }
            return prev;
          });
        }
      } finally {
        setIsLoading(false);
        abortRef.current = null;
        // Return focus to the textarea for fast follow-up.
        requestAnimationFrame(() => textareaRef.current?.focus());
      }
    },
    [messages, isLoading],
  );

  // ---- Stop ------------------------------------------------------------
  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  // ---- Clear -----------------------------------------------------------
  const clear = useCallback(() => {
    if (isLoading) abortRef.current?.abort();
    setMessages([]);
    setError(null);
    setInput("");
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, [isLoading]);

  // ---- Keyboard --------------------------------------------------------
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send(input);
    }
  };

  const isEmpty = messages.length === 0;
  const isStreaming = isLoading && messages.length > 0 &&
    messages[messages.length - 1].role === "assistant";

  return (
    <div className="flex flex-col h-[calc(100vh-11rem)] lg:h-[calc(100vh-8rem)]">
      {/* Header row: title + clear button */}
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <MessageSquare className="h-4 w-4" aria-hidden="true" />
          </span>
          <div>
            <h1 className="text-lg font-semibold tracking-tight leading-tight">
              AI Chat
            </h1>
            <p className="text-xs text-muted-foreground leading-tight">
              Forex education &amp; risk management
            </p>
          </div>
        </div>
        {messages.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={clear}
            disabled={isLoading}
            aria-label="Clear chat"
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
            <span className="hidden sm:inline">Clear chat</span>
          </Button>
        )}
      </div>

      {/* Messages area */}
      <ScrollArea className="flex-1 rounded-lg border border-border bg-card/30">
        <div
          ref={scrollViewportRef}
          className="min-h-full px-3 py-4 sm:px-4"
        >
          {isEmpty ? (
            <EmptyState onPick={(p) => void send(p)} disabled={isLoading} />
          ) : (
            <ul className="space-y-4 max-w-3xl mx-auto">
              {messages.map((m, i) => (
                <li
                  key={i}
                  className={cn(
                    "flex",
                    m.role === "user" ? "justify-end" : "justify-start",
                  )}
                >
                  <MessageBubble message={m} isStreaming={isStreaming && i === messages.length - 1} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </ScrollArea>

      {/* Error banner */}
      {error && (
        <div
          role="alert"
          className="mt-3 flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <div className="flex-1">
            <p className="font-medium">Couldn&apos;t get a reply.</p>
            <p className="text-xs opacity-90 mt-0.5">{error}</p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-destructive hover:text-destructive"
            onClick={() => {
              setError(null);
              if (messages.length > 0 && messages[messages.length - 1].role === "user") {
                void send(messages[messages.length - 1].content);
              }
            }}
            aria-label="Retry last message"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span className="hidden sm:inline ml-1">Retry</span>
          </Button>
        </div>
      )}

      {/* Input area */}
      <div className="mt-3 rounded-lg border border-border bg-card p-2 sm:p-3">
        <div className="flex items-end gap-2">
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Ask about pips, leverage, sessions, risk-reward..."
            rows={1}
            className="min-h-[44px] resize-none border-0 shadow-none focus-visible:ring-0 bg-transparent px-1"
            aria-label="Chat message"
            disabled={isLoading}
            maxLength={4000}
          />
          {isLoading ? (
            <Button
              onClick={stop}
              variant="destructive"
              size="icon"
              aria-label="Stop generating"
              className="h-10 w-10 shrink-0"
            >
              <Square className="h-4 w-4" aria-hidden="true" />
            </Button>
          ) : (
            <Button
              onClick={() => void send(input)}
              disabled={!input.trim()}
              size="icon"
              aria-label="Send message"
              className="h-10 w-10 shrink-0"
            >
              <Send className="h-4 w-4" aria-hidden="true" />
            </Button>
          )}
        </div>
        <p className="mt-1.5 px-1 text-[11px] text-muted-foreground">
          {DISCLAIMER}
          <span className="hidden sm:inline">
            {" "}
            &middot; Enter to send, Shift+Enter for newline.
          </span>
        </p>
      </div>
    </div>
  );
}

/**
 * Throwing wrapper so we can distinguish "expected" API errors (with
 * status + friendly message) from unexpected runtime errors.
 */
class ChatError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ChatError";
    this.status = status;
  }
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function MessageBubble({
  message,
  isStreaming,
}: {
  message: ChatMessage;
  isStreaming: boolean;
}) {
  const isUser = message.role === "user";

  // Typing indicator: assistant placeholder with no content yet.
  const showTyping = !isUser && isStreaming && message.content === "";

  return (
    <div
      className={cn(
        "max-w-[85%] sm:max-w-[75%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
        isUser
          ? "bg-primary text-primary-foreground rounded-br-sm"
          : "bg-card border border-border text-card-foreground rounded-bl-sm",
      )}
    >
      {showTyping ? (
        <TypingDots />
      ) : isUser ? (
        // User content is plain text (no markdown) for safety.
        <p className="whitespace-pre-wrap break-words">{message.content}</p>
      ) : (
        <div className="prose prose-sm prose-invert max-w-none break-words [&_p]:my-1.5 [&_ul]:my-1.5 [&_ol]:my-1.5 [&_li]:my-0.5 [&_pre]:my-2 [&_h1]:text-base [&_h2]:text-sm [&_h3]:text-sm [&_h1]:mt-2 [&_h2]:mt-2 [&_h3]:mt-2">
          <ReactMarkdown>{message.content}</ReactMarkdown>
        </div>
      )}
    </div>
  );
}

function TypingDots() {
  return (
    <div className="flex items-center gap-1 py-1" aria-label="Assistant is typing">
      <span className="h-2 w-2 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:-0.3s]" />
      <span className="h-2 w-2 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:-0.15s]" />
      <span className="h-2 w-2 rounded-full bg-muted-foreground/60 animate-bounce" />
    </div>
  );
}

function EmptyState({
  onPick,
  disabled,
}: {
  onPick: (prompt: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-12 px-4">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary mb-4">
        <MessageSquare className="h-6 w-6" aria-hidden="true" />
      </span>
      <h2 className="text-lg font-semibold">Ask ForexMind anything</h2>
      <p className="mt-1.5 max-w-md text-sm text-muted-foreground">
        Forex education and risk-management help. The assistant never predicts
        prices and never tells you to buy or sell.
      </p>

      <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-xl">
        {EXAMPLE_PROMPTS.map((p) => (
          <button
            key={p}
            type="button"
            disabled={disabled}
            onClick={() => onPick(p)}
            className="text-left rounded-lg border border-border bg-card px-3 py-2.5 text-sm hover:bg-accent/50 hover:border-primary/40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {p}
          </button>
        ))}
      </div>

      <p className="mt-6 text-[11px] text-muted-foreground">{DISCLAIMER}</p>
    </div>
  );
}
