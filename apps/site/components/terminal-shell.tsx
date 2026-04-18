"use client";

import type {
  ConversationTurn,
  SiteSnapshot,
  SseEvent
} from "@academic-homepage/shared";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  BOOT_MESSAGE,
  buildBootEntries,
  createEntry,
  runCommand,
  type TerminalEntry
} from "../lib/terminal";

const TYPE_INTERVAL_MS = 15;
const LINE_SETTLE_MS = 90;
const MOBILE_KEYBOARD_BLUR_THRESHOLD_PX = 18;
const KEYBOARD_RESET_DELAYS_MS = [0, 120, 280, 520];
const INITIAL_VIEWPORT_SNAPSHOT_DELAYS_MS = [0, 240, 720];

function resolveApiBaseUrl() {
  if (typeof window === "undefined") {
    return "";
  }

  const { hostname, origin, protocol, port } = window.location;
  const isLoopback =
    hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";

  if (isLoopback && port !== "8787") {
    return `${protocol}//${hostname}:8787`;
  }

  return "";
}

function parseSseChunk(chunk: string): SseEvent | null {
  const lines = chunk.split("\n");
  let event = "message";
  const data: string[] = [];

  for (const line of lines) {
    if (line.startsWith("event:")) {
      event = line.slice(6).trim();
    }
    if (line.startsWith("data:")) {
      data.push(line.slice(5).trim());
    }
  }

  if (data.length === 0) {
    return null;
  }

  return {
    event: event as SseEvent["event"],
    data: JSON.parse(data.join("\n"))
  } as SseEvent;
}

async function streamAsk(
  body: {
    history: ConversationTurn[];
    message: string;
    sessionId: string;
  },
  signal: AbortSignal,
  handlers: {
    onMeta: () => void;
    onTool: (message: string) => void;
    onToken: (text: string) => void;
    onError: (message: string) => void;
    onDone: () => void;
  }
) {
  const apiBaseUrl = resolveApiBaseUrl();
  const response = await fetch(`${apiBaseUrl}/ask`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body),
    signal
  });

  if (!response.body) {
    throw new Error("edge worker returned no readable stream.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });

    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const rawChunk = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);

      const event = parseSseChunk(rawChunk);
      if (event) {
        switch (event.event) {
          case "meta":
            handlers.onMeta();
            break;
          case "tool":
            handlers.onTool(event.data.message);
            break;
          case "token":
            handlers.onToken(event.data.text);
            break;
          case "error":
            handlers.onError(event.data.message);
            break;
          case "done":
            handlers.onDone();
            return;
          default:
            break;
        }
      }

      boundary = buffer.indexOf("\n\n");
    }

    if (done) {
      break;
    }
  }

  handlers.onDone();
}

function kindToClassName(kind: TerminalEntry["kind"]) {
  switch (kind) {
    case "user":
      return "text-phosphor-50";
    case "assistant":
      return "text-phosphor-100";
    case "tool":
      return "text-phosphor-500";
    case "error":
      return "text-rose-300";
    case "system":
    default:
      return "text-phosphor-700";
  }
}

function wait(ms: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function getTypingDuration(text: string) {
  return Math.max(text.length, 1) * TYPE_INTERVAL_MS + LINE_SETTLE_MS;
}

function restoreDocumentViewportPosition(behavior: ScrollBehavior = "auto") {
  if (typeof window === "undefined") {
    return;
  }

  window.scrollTo({ top: 0, left: 0, behavior });
  document.documentElement.scrollTo?.({ top: 0, left: 0, behavior });
  document.body.scrollTo?.({ top: 0, left: 0, behavior });
}

function TypingText({ text, isTyping }: { text: string; isTyping?: boolean }) {
  const [displayedText, setDisplayedText] = useState(isTyping ? "" : text);

  useEffect(() => {
    if (!isTyping) {
      setDisplayedText(text);
      return;
    }

    let i = 0;
    const interval = setInterval(() => {
      setDisplayedText(text.slice(0, i + 1));
      i++;
      if (i >= text.length) {
        clearInterval(interval);
      }
    }, TYPE_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [text, isTyping]);

  return <>{displayedText || " "}</>;
}

export function TerminalShell({ snapshot }: { snapshot: SiteSnapshot }) {
  const [entries, setEntries] = useState<TerminalEntry[]>(() =>
    buildBootEntries(snapshot)
  );
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const [keyboardInset, setKeyboardInset] = useState(0);
  const [conversationHistory, setConversationHistory] = useState<ConversationTurn[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [isFirstInteraction, setIsFirstInteraction] = useState(true);
  const [activeAssistantEntryId, setActiveAssistantEntryId] = useState<string | null>(null);
  const [abortController, setAbortController] = useState<AbortController | null>(null);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const historyRef = useRef<string[]>([]);
  const historyIndexRef = useRef<number>(0);
  const activeRequestIdRef = useRef<string | null>(null);
  const lineSequenceRef = useRef(0);
  const touchStartYRef = useRef<number | null>(null);
  const touchBlurredRef = useRef(false);
  const viewportResetTimersRef = useRef<number[]>([]);
  const initialViewportTimersRef = useRef<number[]>([]);
  const isFocusedRef = useRef(false);
  const settledViewportHeightRef = useRef(0);
  const sessionId = useMemo(() => crypto.randomUUID(), []);

  useEffect(() => {
    if (window.innerWidth >= 768) {
      inputRef.current?.focus();
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const mediaQuery = window.matchMedia("(max-width: 767px)");
    const updateViewportMode = () => setIsMobileViewport(mediaQuery.matches);

    updateViewportMode();
    mediaQuery.addEventListener("change", updateViewportMode);

    return () => {
      mediaQuery.removeEventListener("change", updateViewportMode);
    };
  }, []);

  useEffect(() => {
    isFocusedRef.current = isFocused;
  }, [isFocused]);

  const clearViewportResetTimers = () => {
    for (const timerId of viewportResetTimersRef.current) {
      window.clearTimeout(timerId);
    }

    viewportResetTimersRef.current = [];
  };

  const clearInitialViewportTimers = () => {
    for (const timerId of initialViewportTimersRef.current) {
      window.clearTimeout(timerId);
    }

    initialViewportTimersRef.current = [];
  };

  const scrollOutputToLatest = (behavior: ScrollBehavior = "auto") => {
    const viewport = scrollRef.current;
    if (!viewport) {
      return;
    }

    viewport.scrollTo({
      top: viewport.scrollHeight,
      behavior
    });
  };

  const syncAppHeight = (height: number) => {
    document.documentElement.style.setProperty("--app-height", `${Math.round(height)}px`);
  };

  const readVisibleViewportHeight = () =>
    window.visualViewport?.height ??
    window.innerHeight ??
    document.documentElement.clientHeight;

  const captureSettledViewportHeight = () => {
    const height = Math.round(
      Math.max(
        window.visualViewport?.height ?? 0,
        window.innerHeight,
        document.documentElement.clientHeight
      )
    );
    settledViewportHeightRef.current = Math.max(settledViewportHeightRef.current, height);
    return settledViewportHeightRef.current;
  };

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const updateAppHeight = () => {
      const visibleHeight = Math.round(readVisibleViewportHeight());

      if (!isFocusedRef.current) {
        captureSettledViewportHeight();
      }

      const stableHeight =
        settledViewportHeightRef.current > 0 ? settledViewportHeightRef.current : visibleHeight;
      const viewportOffsetTop = Math.round(window.visualViewport?.offsetTop ?? 0);
      const nextKeyboardInset = isFocusedRef.current
        ? Math.max(0, stableHeight - visibleHeight - viewportOffsetTop)
        : 0;

      syncAppHeight(stableHeight);
      setKeyboardInset(nextKeyboardInset);
    };

    let frameId = 0;
    const syncViewport = () => {
      cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(() => {
        updateAppHeight();

        if (document.activeElement !== inputRef.current) {
          restoreDocumentViewportPosition("auto");
        }
      });
    };

    updateAppHeight();
    clearInitialViewportTimers();
    initialViewportTimersRef.current = INITIAL_VIEWPORT_SNAPSHOT_DELAYS_MS.map((delay) =>
      window.setTimeout(() => {
        if (isFocusedRef.current) {
          return;
        }

        syncAppHeight(captureSettledViewportHeight());
        restoreDocumentViewportPosition("auto");
      }, delay)
    );

    window.visualViewport?.addEventListener("resize", syncViewport);
    window.addEventListener("orientationchange", syncViewport);

    return () => {
      cancelAnimationFrame(frameId);
      clearInitialViewportTimers();
      window.visualViewport?.removeEventListener("resize", syncViewport);
      window.removeEventListener("orientationchange", syncViewport);
    };
  }, []);

  useEffect(() => {
    scrollOutputToLatest("smooth");
  }, [entries]);

  const isBootState =
    entries.length === 1 &&
    entries[0]?.kind === "system" &&
    entries[0]?.text === BOOT_MESSAGE;

  const interruptActiveRequest = () => {
    const requestId = activeRequestIdRef.current;
    if (!abortController || !requestId) {
      return;
    }

    activeRequestIdRef.current = null;
    abortController.abort();
    setAbortController(null);
    setIsStreaming(false);
    setActiveAssistantEntryId(null);
    setEntries((current) => {
      const next = current.filter(
        (entry) => !(entry.id === requestId && !entry.text.trim())
      );

      return [...next, createEntry("system", "request interrupted.")];
    });
  };

  const appendSystemLinesSequentially = async (
    lines: string[],
    sequenceId: number
  ) => {
    for (const line of lines) {
      if (lineSequenceRef.current !== sequenceId) {
        return;
      }

      setEntries((current) => [...current, createEntry("system", line, true)]);
      await wait(getTypingDuration(line));
    }
  };

  const runRemoteQuestion = async (question: string) => {
    const requestId = crypto.randomUUID();
    let assistantText = "";
    let requestFailed = false;

    const controller = new AbortController();
    activeRequestIdRef.current = requestId;
    setAbortController(controller);

    setActiveAssistantEntryId(requestId);
    setEntries((current) => [
      ...current,
      {
        id: requestId,
        kind: "assistant",
        text: ""
      }
    ]);
    setIsStreaming(true);

    try {
      await streamAsk(
        {
          message: question,
          sessionId,
          history: conversationHistory
        },
        controller.signal,
        {
          onMeta: () => {},
          onTool: (message) => {
            if (activeRequestIdRef.current !== requestId) {
              return;
            }

            setEntries((current) => {
              const toolEntry = createEntry("system", message);
              const assistantIndex = current.findIndex(
                (entry) => entry.id === requestId
              );

              if (assistantIndex === -1) {
                return [...current, toolEntry];
              }

              return [
                ...current.slice(0, assistantIndex),
                toolEntry,
                ...current.slice(assistantIndex)
              ];
            });
          },
          onToken: (text) => {
            if (activeRequestIdRef.current !== requestId) {
              return;
            }

            assistantText += text;
            setEntries((current) =>
              current.map((entry) =>
                entry.id === requestId
                  ? {
                      ...entry,
                      text: `${entry.text}${text}`
                    }
                  : entry
              )
            );
          },
          onError: (message) => {
            if (activeRequestIdRef.current !== requestId) {
              return;
            }

            requestFailed = true;
            activeRequestIdRef.current = null;
            setAbortController(null);
            setEntries((current) => {
              const next = current.filter((entry) => entry.id !== requestId);
              return [...next, createEntry("error", message)];
            });
            setActiveAssistantEntryId(null);
            setIsStreaming(false);
          },
          onDone: () => {
            if (activeRequestIdRef.current !== requestId) {
              return;
            }

            if (!requestFailed && assistantText.trim()) {
              setConversationHistory((current) => [
                ...current.slice(-4),
                {
                  user: question,
                  assistant: assistantText.trim()
                }
              ]);
            }
            activeRequestIdRef.current = null;
            setAbortController(null);
            setIsStreaming(false);
            setActiveAssistantEntryId(null);
          }
        }
      );
    } catch (error: any) {
      if (error.name === "AbortError") {
        return;
      }

      if (activeRequestIdRef.current !== requestId) {
        return;
      }

      activeRequestIdRef.current = null;
      setAbortController(null);
      if (error.name !== "AbortError") {
        const message =
          error instanceof Error ? error.message : "streaming failed.";
        setEntries((current) => {
          const next = current.filter((entry) => entry.id !== requestId);
          return [...next, createEntry("error", message)];
        });
      }
      setIsStreaming(false);
      setActiveAssistantEntryId(null);
    }
  };

  const executeCommand = async (raw: string) => {
    const lineSequenceId = lineSequenceRef.current + 1;
    lineSequenceRef.current = lineSequenceId;
    setIsFirstInteraction(false);
    historyRef.current = [...historyRef.current, raw];
    historyIndexRef.current = historyRef.current.length;
    setEntries((current) => [...current, createEntry("user", raw)]);
    setInput("");

    const result = runCommand(raw, snapshot);
    if (result.type === "clear") {
      setEntries(buildBootEntries(snapshot));
      setConversationHistory([]);
      setAbortController(null);
      activeRequestIdRef.current = null;
      return;
    }

    if (result.type === "local") {
      const lines = result.lines;
      if (lines?.length) {
        await appendSystemLinesSequentially(lines, lineSequenceId);
      }
      return;
    }

    if (result.question) {
      await runRemoteQuestion(result.question);
    }
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    interruptActiveRequest();

    const typedInput = input.trim();
    const shouldAutoHelp = !typedInput && isBootState && isFirstInteraction;
    const raw = typedInput || (shouldAutoHelp ? "/help" : "");
    if (!raw) {
      return;
    }

    await executeCommand(raw);
  };

  const handleViewportTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    if (window.innerWidth >= 768 || !isFocused) {
      touchStartYRef.current = null;
      touchBlurredRef.current = false;
      return;
    }

    touchStartYRef.current = event.touches[0]?.clientY ?? null;
    touchBlurredRef.current = false;
  };

  const handleViewportTouchMove = (event: React.TouchEvent<HTMLDivElement>) => {
    if (
      window.innerWidth >= 768 ||
      !isFocused ||
      touchStartYRef.current === null ||
      touchBlurredRef.current
    ) {
      return;
    }

    const currentY = event.touches[0]?.clientY;
    if (typeof currentY !== "number") {
      return;
    }

    if (touchStartYRef.current - currentY > MOBILE_KEYBOARD_BLUR_THRESHOLD_PX) {
      inputRef.current?.blur();
      touchBlurredRef.current = true;
    }
  };

  const resetViewportTouchTracking = () => {
    touchStartYRef.current = null;
    touchBlurredRef.current = false;
  };

  const handleHistoryKey = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Tab") {
      event.preventDefault();
      const current = input.trim().toLowerCase();
      if (current.startsWith("/")) {
        const available = ["/help", "/about", "/contact", "/clear"];
        const match = available.find((cmd) => cmd.startsWith(current));
        if (match) setInput(match + " ");
      }
      return;
    }

    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") {
      return;
    }

    event.preventDefault();

    if (historyRef.current.length === 0) {
      return;
    }

    if (event.key === "ArrowUp") {
      historyIndexRef.current = Math.max(0, historyIndexRef.current - 1);
    } else {
      historyIndexRef.current = Math.min(
        historyRef.current.length,
        historyIndexRef.current + 1
      );
    }

    if (historyIndexRef.current === historyRef.current.length) {
      setInput("");
      return;
    }

    setInput(historyRef.current[historyIndexRef.current] ?? "");
  };

  const stabilizeFocusViewport = () => {
    clearViewportResetTimers();

    viewportResetTimersRef.current = KEYBOARD_RESET_DELAYS_MS.map((delay) =>
      window.setTimeout(() => {
        if (document.activeElement !== inputRef.current) {
          return;
        }

        const currentHeight = readVisibleViewportHeight();
        const stableHeight =
          settledViewportHeightRef.current > 0
            ? settledViewportHeightRef.current
            : Math.round(currentHeight);
        const viewportOffsetTop = Math.round(window.visualViewport?.offsetTop ?? 0);

        syncAppHeight(stableHeight);
        setKeyboardInset(
          Math.max(0, stableHeight - Math.round(currentHeight) - viewportOffsetTop)
        );
        restoreDocumentViewportPosition("auto");
        scrollOutputToLatest("auto");
      }, delay)
    );
  };

  const handleInputBlur = () => {
    setIsFocused(false);
    setKeyboardInset(0);
    clearViewportResetTimers();

    viewportResetTimersRef.current = KEYBOARD_RESET_DELAYS_MS.map((delay) =>
      window.setTimeout(() => {
        restoreDocumentViewportPosition("auto");

        const fallbackHeight = Math.max(
          captureSettledViewportHeight(),
          Math.round(readVisibleViewportHeight())
        );

        syncAppHeight(fallbackHeight);
        setKeyboardInset(0);
        scrollOutputToLatest("auto");
      }, delay)
    );
  };

  const entriesMarkup = (
    <div className="space-y-1">
      {entries.map((entry, index) =>
        entry.kind === "user" ? (
          <div
            key={entry.id}
            className={`flex items-baseline gap-3 ${index > 0 ? "pt-3" : ""}`}
          >
            <span className="w-[2ch] flex-none text-sm font-medium leading-6 text-phosphor-300 md:text-[15px] md:leading-6">
              $
            </span>
            <p className="whitespace-pre-wrap break-words text-sm leading-6 text-phosphor-50 md:text-[15px] md:leading-6">
              {entry.text || " "}
            </p>
          </div>
        ) : (
          <p
            key={entry.id}
            className={`whitespace-pre-wrap break-words text-sm leading-6 md:text-[15px] md:leading-6 ${kindToClassName(
              entry.kind
            )}`}
          >
            <TypingText text={entry.text} isTyping={entry.isTyping} />
            {entry.id === activeAssistantEntryId && isStreaming ? (
              <span aria-hidden="true" className="terminal-inline-cursor ml-[0.2em]">
                █
              </span>
            ) : null}
          </p>
        )
      )}
    </div>
  );

  const composerMarkup = (
    <form
      onSubmit={handleSubmit}
      className="relative z-10 flex shrink-0 flex-col border-t border-phosphor-900/30 bg-[#020d07]/97 pt-3 backdrop-blur-md md:border-t-0 md:bg-black/40 md:pt-4 md:backdrop-blur-none"
    >
      {isMobileViewport ? (
        <div
          className={`terminal-scrollbar flex shrink-0 gap-2 overflow-x-auto px-4 pb-3 ${
            input ? "hidden" : ""
          }`}
        >
          {["/about", "/contact", "/help", "/clear"].map((cmd) => (
            <button
              key={cmd}
              type="button"
              onClick={() => {
                interruptActiveRequest();
                executeCommand(cmd);
              }}
              className="whitespace-nowrap rounded-sm bg-[#062512] px-4 py-1.5 text-xs font-medium tracking-wide text-phosphor-100 shadow-[inset_0_1px_0_rgba(141,244,141,0.15),0_1px_2px_rgba(0,0,0,0.4)] transition-all active:bg-phosphor-900 active:shadow-[inset_0_2px_4px_rgba(0,0,0,0.5)]"
            >
              {cmd}
            </button>
          ))}
        </div>
      ) : null}

      <label className="flex shrink-0 cursor-text items-center gap-3 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:px-7 md:pb-4">
        <span className="type-prompt text-2xl text-phosphor-300">$</span>
        <div className="relative flex-1">
          <div className="pointer-events-none flex min-h-6 items-center overflow-hidden text-sm text-phosphor-50 md:min-h-[1.5rem] md:text-[15px]">
            {input ? <span className="whitespace-pre-wrap break-all">{input}</span> : null}
            <span
              aria-hidden="true"
              className={`terminal-block-cursor ${input ? "ml-[0.18em]" : "mr-[0.5em]"} ${
                isFocused ? "opacity-100" : "opacity-70"
              }`}
            >
              █
            </span>
            {!input ? <span className="opacity-30">Type /help for commands...</span> : null}
          </div>
          <input
            ref={inputRef}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleHistoryKey}
            onFocus={() => {
              setIsFocused(true);
              stabilizeFocusViewport();
            }}
            onBlur={handleInputBlur}
            spellCheck={false}
            autoCapitalize="none"
            autoComplete="off"
            autoCorrect="off"
            aria-label="Terminal input"
            className="terminal-hidden-input absolute inset-0 w-full border-none bg-transparent text-base outline-none md:text-[15px]"
          />
        </div>
      </label>
    </form>
  );

  if (isMobileViewport) {
    return (
      <section className="fixed inset-0 z-20 grid h-[var(--app-height)] min-h-0 w-screen grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-none border-none bg-gradient-to-b from-[#02110a] to-[#010a05] pt-0">
        <div className="mobile-scanlines absolute inset-0 z-0 opacity-50" aria-hidden="true" />
        <div className="pointer-events-none absolute inset-x-0 top-0 z-0 h-24 bg-gradient-to-b from-phosphor-500/10 to-transparent" />
        <div className="scan-pass pointer-events-none absolute inset-x-0 top-[-30%] z-0 h-24 bg-gradient-to-b from-transparent via-phosphor-100/10 to-transparent blur-2xl" />

        <header className="relative z-10 flex shrink-0 items-center justify-between border-b border-phosphor-900/30 bg-[#031109]/96 px-4 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))] backdrop-blur-md">
          <span className="type-prompt text-xs font-bold tracking-widest text-phosphor-500/80">
            SYS.OP // ONLINE
          </span>
          <span className="h-2 w-2 rounded-full bg-phosphor-500 shadow-[0_0_8px_rgba(71,230,91,0.8)] animate-pulse" />
        </header>

        <div
          ref={scrollRef}
          className="terminal-scroll-region terminal-scrollbar relative z-10 min-h-0 overflow-y-auto px-4 py-4"
          onTouchStart={handleViewportTouchStart}
          onTouchMove={handleViewportTouchMove}
          onTouchEnd={resetViewportTouchTracking}
          onTouchCancel={resetViewportTouchTracking}
          aria-live="polite"
          aria-atomic="false"
          style={{ paddingBottom: `${16 + keyboardInset}px` }}
        >
          {entriesMarkup}
        </div>

        <div style={{ transform: `translateY(-${keyboardInset}px)` }}>{composerMarkup}</div>
      </section>
    );
  }

  return (
    <section className="relative flex h-[min(84dvh,760px)] min-h-0 w-full max-w-[920px] flex-col overflow-hidden rounded-xl border border-phosphor-900/50 bg-gradient-to-b from-[#02110a]/95 to-[#010a05]/95 shadow-phosphor backdrop-blur-xl">
      <div className="pointer-events-none absolute inset-x-0 top-0 z-0 h-24 bg-gradient-to-b from-phosphor-500/10 to-transparent" />
      <div className="scan-pass pointer-events-none absolute inset-x-0 top-[-30%] z-0 h-24 bg-gradient-to-b from-transparent via-phosphor-100/10 to-transparent blur-2xl" />

      <header className="relative z-10 bg-black/20 px-5 py-5 md:px-7">
        <p className="type-prompt text-3xl uppercase tracking-[0.28em] text-phosphor-50">
          Terminal
        </p>
      </header>

      <div
        ref={scrollRef}
        className="terminal-scroll-region terminal-scrollbar relative z-10 min-h-0 flex-1 overflow-y-auto px-7 py-10"
        aria-live="polite"
        aria-atomic="false"
      >
        {entriesMarkup}
      </div>

      {composerMarkup}
    </section>
  );
}
