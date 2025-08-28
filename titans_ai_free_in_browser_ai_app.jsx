import React, { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { MessageSquare, Sparkles, Scissors, Bot, Trash2, Download, Mic, Volume2, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

/**
 * TITANS AI — fully featured free, publishable AI tool.npm run build
npm run build

 *
 * Robust loader: this version handles environments where the ONNX runtime
 * hasn't been registered yet (common with some bundlers). It will attempt
 * to dynamically inject the onnxruntime-web script from a CDN and retry
 * loading `@xenova/transformers`. If that still fails it surfaces a clear
 * error message in the UI instead of crashing with `registerBackend`.
 *
 * Features (summary): chat, summarizer, sentiment, voice input, TTS,
 * settings, export, and a small diagnostics test suite.
 */

// ---- Helpers & Robust loader ------------------------------------------------
let transformersPromise: Promise<any> | null = null;

async function tryLoadExternalScript(url: string, attrs: Record<string, string> = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof document === "undefined") return reject(new Error("No document available"));
    // If script already exists, resolve immediately
    for (const s of Array.from(document.getElementsByTagName("script"))) {
      if (s.getAttribute("src") === url) return resolve();
    }
    const script = document.createElement("script");
    script.src = url;
    script.async = true;
    Object.entries(attrs).forEach(([k, v]) => script.setAttribute(k, v));
    script.onload = () => setTimeout(resolve, 50); // give a short tick for wasm to initialize
    script.onerror = () => reject(new Error(`Failed to load script: ${url}`));
    document.head.appendChild(script);
  });
}

async function loadTransformers() {
  if (typeof window === "undefined") {
    throw new Error("TITANS AI must run in the browser (no SSR).");
  }

  if (transformersPromise) return transformersPromise;

  // Encapsulate import attempts in a single promise so callers share the result
  transformersPromise = (async () => {
    // Try direct import first (preferred)
    try {
      const mod = await import("@xenova/transformers");
      return mod;
    } catch (firstErr) {
      console.warn("Initial @xenova/transformers import failed:", firstErr);

      // If it fails with registerBackend (or similar), try to inject onnxruntime-web
      try {
        // Common CDN build for onnxruntime-web
        await tryLoadExternalScript("https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/ort-wasm.js");
        // Retry import after loading runtime
        const mod2 = await import("@xenova/transformers");
        return mod2;
      } catch (secondErr) {
        console.error("Retrying import after loading onnxruntime-web also failed:", secondErr);
        // As a last resort, surface helpful guidance to the caller
        throw new Error(
          (secondErr && secondErr.message) || "Failed to load @xenova/transformers. Ensure onnxruntime-web is available or run in a modern browser."
        );
      }
    }
  })();

  return transformersPromise;
}

// ---- Models ----------------------------------------------------------------
const MODEL_CATALOG = {
  chat: {
    task: "text-generation",
    model: "Xenova/Qwen2.5-0.5B-Instruct",
    options: { temperature: 0.7, max_new_tokens: 256, top_p: 0.95 },
    systemPrompt:
      "You are TITANS AI, a helpful, concise assistant. Use markdown when helpful. Be polite and avoid hallucinations.",
  },
  summarize: { task: "text2text-generation", model: "Xenova/t5-small" },
  sentiment: { task: "sentiment-analysis", model: "Xenova/distilbert-base-uncased-finetuned-sst-2-english" },
} as const;

type SettingsState = {
  theme: "light" | "dark";
  tts: boolean;
  models: { chat: string; summarize: string; sentiment: string };
};

const cn = (...classes: (string | undefined | false)[]) => classes.filter(Boolean).join(" ");

const TitanBadge: React.FC = () => (
  <div className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-indigo-600 to-purple-600 px-4 py-2 text-white shadow">
    <Sparkles className="h-4 w-4" />
    <span className="font-semibold tracking-wide">TITANS AI</span>
  </div>
);

const SectionHeader: React.FC<{ title: string; icon: React.ReactNode; subtitle?: string }>
= ({ title, icon, subtitle }) => (
  <div className="flex items-start justify-between">
    <div>
      <h2 className="text-2xl font-bold tracking-tight">{title}</h2>
      {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
    </div>
    <div className="text-muted-foreground">{icon}</div>
  </div>
);

const Bubble: React.FC<{ role: "user" | "assistant"; children: React.ReactNode }>=({ role, children }) => (
  <div className={cn("max-w-[85%] rounded-2xl p-3 shadow", role === "user" ? "ml-auto bg-indigo-50" : "bg-white border dark:bg-slate-800")}>{children}</div>
);

function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

export default function App() {
  const [tab, setTab] = useState<"chat" | "summarize" | "sentiment" | "settings">("chat");
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState<string>("Initializing…");

  // Pipelines
  const chatPipeRef = useRef<any>(null);
  const sumPipeRef = useRef<any>(null);
  const sentPipeRef = useRef<any>(null);

  // Chat state
  const [chatInput, setChatInput] = useState("");
  const [messages, setMessages] = useState<{ role: "user" | "assistant"; content: string }[]>(() => {
    const seed = [
      { role: "assistant" as const, content: "Hey! I'm **TITANS AI**. How can I help today?" },
    ];
    try {
      const saved = localStorage.getItem("titans.chat");
      return saved ? JSON.parse(saved) : seed;
    } catch { return seed; }
  });

  useEffect(() => {
    localStorage.setItem("titans.chat", JSON.stringify(messages));
  }, [messages]);

  // Settings
  const [settings, setSettings] = useState<SettingsState>(() => {
    try {
      const raw = localStorage.getItem("titans.settings");
      if (raw) return JSON.parse(raw);
    } catch {}
    return {
      theme: "light",
      tts: false,
      models: {
        chat: MODEL_CATALOG.chat.model,
        summarize: MODEL_CATALOG.summarize.model,
        sentiment: MODEL_CATALOG.sentiment.model,
      },
    };
  });

  useEffect(() => {
    localStorage.setItem("titans.settings", JSON.stringify(settings));
  }, [settings]);

  // Ensure pipeline exists (safe; retry + clear guidance on failure)
  async function ensurePipeline(which: keyof typeof MODEL_CATALOG) {
    setStatus("Loading models… (first run may take a minute)");
    try {
      const tf = await loadTransformers();
      const { pipeline } = tf;

      if (which === "chat" && !chatPipeRef.current) {
        chatPipeRef.current = await pipeline(
          MODEL_CATALOG.chat.task as any,
          settings.models.chat || MODEL_CATALOG.chat.model
        );
      }
      if (which === "summarize" && !sumPipeRef.current) {
        sumPipeRef.current = await pipeline(
          MODEL_CATALOG.summarize.task as any,
          settings.models.summarize || MODEL_CATALOG.summarize.model
        );
      }
      if (which === "sentiment" && !sentPipeRef.current) {
        sentPipeRef.current = await pipeline(
          MODEL_CATALOG.sentiment.task as any,
          settings.models.sentiment || MODEL_CATALOG.sentiment.model
        );
      }

      setReady(true);
      setStatus("Ready");
    } catch (err: any) {
      console.error("Failed to prepare pipeline:", err);
      setStatus(
        `Model backend init failed: ${err?.message || err}. Try allowing network access or add onnxruntime-web to your page (see console).`
      );
      // rethrow so callers know the pipeline creation failed
      throw err;
    }
  }

  // Chat send (with error handling)
  async function handleSend() {
    if (!chatInput.trim()) return;
    const user = { role: "user" as const, content: chatInput.trim() };
    setMessages((m) => [...m, user]);
    setChatInput("");

    try {
      await ensurePipeline("chat");
      const sys = MODEL_CATALOG.chat.systemPrompt;
      const history = messages.map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`).join("\n");
      const prompt = `${sys}\n\n${history}\nUser: ${user.content}\nAssistant:`;

      const gen = await chatPipeRef.current(prompt, MODEL_CATALOG.chat.options);
      const text: string = gen?.[0]?.generated_text?.slice(prompt.length) || gen?.[0]?.generated_text || "(no response)";
      setMessages((m) => [...m, { role: "assistant", content: text.trim() }]);

      if (settings.tts) speak(text.trim());
    } catch (err: any) {
      const msg = `Error: ${err?.message || err}`;
      setMessages((m) => [...m, { role: "assistant", content: msg }]);
      setStatus(msg);
    }
  }

  // Summarize
  const [rawText, setRawText] = useState("");
  const [sumText, setSumText] = useState("");
  const [sumLoading, setSumLoading] = useState(false);
  async function doSummarize() {
    setSumLoading(true);
    try {
      await ensurePipeline("summarize");
      const input = rawText.trim();
      let out = "";
      if (input) {
        const prefixed = `summarize: ${input}`;
        const res = await sumPipeRef.current(prefixed, { max_new_tokens: 128 });
        out = res?.[0]?.summary_text || res?.[0]?.generated_text || "";
      }
      setSumText(out);
    } catch (err: any) {
      setSumText(`Error: ${err?.message || err}`);
    }
    setSumLoading(false);
  }

  // Sentiment
  const [sentText, setSentText] = useState("");
  const [sentResult, setSentResult] = useState<any>(null);
  const [sentLoading, setSentLoading] = useState(false);
  async function doSentiment() {
    setSentLoading(true);
    try {
      await ensurePipeline("sentiment");
      const res = await sentPipeRef.current(sentText || "");
      setSentResult(res?.[0] || null);
    } catch (err: any) {
      setSentResult({ label: "ERROR", score: 0, detail: String(err?.message || err) });
    }
    setSentLoading(false);
  }

  // Voice input (Web Speech API)
  function recordVoice() {
    const SR: any = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
    if (!SR) {
      alert("Speech recognition not supported in this browser.");
      return;
    }
    const recognizer = new SR();
    recognizer.lang = "en-US";
    recognizer.onresult = (e: any) => {
      const text = e.results?.[0]?.[0]?.transcript || "";
      setChatInput(text);
    };
    recognizer.onerror = () => alert("Speech recognition error. Try again.");
    recognizer.start();
  }

  // TTS helper
  function speak(text: string) {
    const synth = window.speechSynthesis;
    if (!synth) return;
    const u = new SpeechSynthesisUtterance(text);
    synth.cancel();
    synth.speak(u);
  }

  // UI helpers
  const TabButton: React.FC<{ id: typeof tab; label: string; icon: React.ReactNode }>=({ id, label, icon }) => (
    <button onClick={() => setTab(id)} className={cn(
      "inline-flex items-center gap-2 rounded-2xl px-4 py-2 text-sm font-medium transition",
      tab === id ? "bg-indigo-600 text-white shadow" : "bg-muted hover:bg-muted/80"
    )}>
      {icon} {label}
    </button>
  );

  // Self-tests (no network/model downloads)
  const [testResults, setTestResults] = useState<{ name: string; ok: boolean; detail?: string }[] | null>(null);
  function runSelfTests() {
    const results: { name: string; ok: boolean; detail?: string }[] = [];
    function test(name: string, fn: () => void) {
      try { fn(); results.push({ name, ok: true }); }
      catch (e: any) { results.push({ name, ok: false, detail: String(e?.message || e) }); }
    }

    // Existing tests
    test("cn() joins truthy classes", () => {
      if (cn("a", false, "b") !== "a b") throw new Error("Unexpected join output");
    });
    test("downloadText() can create and revoke object URL", () => {
      const url = URL.createObjectURL(new Blob(["x"]));
      URL.revokeObjectURL(url);
    });
    test("settings contain model IDs", () => {
      if (!settings.models.chat || !settings.models.summarize || !settings.models.sentiment) throw new Error("Missing model id");
    });
    test("lazy loader is callable in browser", () => {
      if (typeof window === "undefined") throw new Error("Not in browser");
      if (typeof loadTransformers !== "function") throw new Error("Loader missing");
    });

    // New test: script injector exists
    test("script injector exists", () => {
      if (typeof tryLoadExternalScript !== "function") throw new Error("Script loader missing");
    });

    setTestResults(results);
    console.table(results);
  }

  return (
    <div className={cn("min-h-screen", settings.theme === "dark" ? "bg-slate-900 text-white" : "bg-gradient-to-b from-slate-50 to-white")}> 
      <header className="sticky top-0 z-10 border-b bg-white/80 backdrop-blur dark:bg-slate-800/80">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-3">
            <TitanBadge />
            <span className="hidden text-sm text-muted-foreground sm:inline">Free, private, in‑browser AI toolkit</span>
          </motion.div>
          <div className="flex items-center gap-2">
            <TabButton id="chat" label="Chat" icon={<Bot className="h-4 w-4" />} />
            <TabButton id="summarize" label="Summarize" icon={<Scissors className="h-4 w-4" />} />
            <TabButton id="sentiment" label="Sentiment" icon={<MessageSquare className="h-4 w-4" />} />
            <TabButton id="settings" label="Settings" icon={<Settings className="h-4 w-4" />} />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6">
        {!ready && (
          <div className="mb-6 text-sm text-muted-foreground">{status}</div>
        )}

        {tab === "chat" && (
          <Card className="border-0 shadow-lg">
            <CardHeader>
              <SectionHeader
                title="Chat Assistant"
                subtitle="Privacy-first chatbot powered by a compact open-source instruct model"
                icon={<Bot className="h-5 w-5" />}
              />
            </CardHeader>
            <CardContent>
              <div className="flex h-[60vh] flex-col gap-3">
                <div className="hide-scrollbar flex-1 space-y-3 overflow-y-auto rounded-2xl bg-slate-50 p-3 dark:bg-slate-700">
                  {messages.map((m, i) => (
                    <div key={i} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
                      <Bubble role={m.role}>
                        {/* Render as plain text with line breaks to avoid XSS; markdown can be added later */}
                        <div className="prose prose-sm max-w-none whitespace-pre-wrap">
                          {m.content}
                        </div>
                      </Bubble>
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    placeholder="Ask TITANS AI anything…"
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) handleSend(); }}
                  />
                  <Button onClick={handleSend} className="rounded-2xl">Send</Button>
                  <Button variant="secondary" onClick={recordVoice} title="Voice input" className="rounded-2xl">
                    <Mic className="h-4 w-4" />
                  </Button>
                  <Button variant="secondary" onClick={() => {
                    setMessages([{ role: "assistant", content: "Cleared! Ask me anything." }]);
                    localStorage.removeItem("titans.chat");
                  }} title="Clear chat" className="rounded-2xl" >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                  <Button variant="secondary" onClick={() => {
                    const last = [...messages].reverse().find(m => m.role === "assistant");
                    if (last) speak(last.content);
                  }} title="Speak last reply" className="rounded-2xl">
                    <Volume2 className="h-4 w-4" />
                  </Button>
                  <Button variant="outline" onClick={() => downloadText("titans-chat.txt", messages.map(m=>`[${m.role}] ${m.content}`).join("\n\n"))} className="rounded-2xl">
                    <Download className="h-4 w-4 mr-2" /> Export
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {tab === "summarize" && (
          <Card className="border-0 shadow-lg">
            <CardHeader>
              <SectionHeader title="Text Summarizer" subtitle="Paste long text; get a concise summary" icon={<Scissors className="h-5 w-5" />} />
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Textarea className="min-h-[260px]" placeholder="Paste text here…" value={rawText} onChange={(e)=>setRawText(e.target.value)} />
                  <div className="flex gap-2">
                    <Button disabled={sumLoading} onClick={doSummarize}>Summarize</Button>
                    <Button variant="secondary" onClick={()=>{ setRawText(""); setSumText(""); }}>Clear</Button>
                    <Button variant="outline" onClick={()=>downloadText("titans-summary.txt", sumText || "")}>Export</Button>
                  </div>
                </div>
                <div>
                  <div className="rounded-2xl border bg-white p-3 min-h-[260px] dark:bg-slate-800">
                    {sumLoading ? <p className="text-sm text-muted-foreground">Working…</p> : (
                      sumText ? <div className="prose prose-sm max-w-none whitespace-pre-wrap">{sumText}</div> : <p className="text-sm text-muted-foreground">Your summary will appear here.</p>
                    )}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {tab === "sentiment" && (
          <Card className="border-0 shadow-lg">
            <CardHeader>
              <SectionHeader title="Sentiment Analyzer" subtitle="Classify text with confidence" icon={<MessageSquare className="h-5 w-5" />} />
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <Textarea placeholder="Type a sentence to analyze…" value={sentText} onChange={(e)=>setSentText(e.target.value)} />
                <div className="flex gap-2">
                  <Button disabled={sentLoading} onClick={doSentiment}>Analyze</Button>
                  <Button variant="secondary" onClick={()=>{ setSentResult(null); setSentText(""); }}>Clear</Button>
                </div>
                <div className="rounded-2xl border bg-white p-3 dark:bg-slate-800">
                  {sentLoading ? (
                    <p className="text-sm text-muted-foreground">Working…</p>
                  ) : sentResult ? (
                    <div className="flex items-center justify-between text-sm">
                      <div className="font-medium">{sentResult.label}</div>
                      <div className="text-muted-foreground">Confidence: {(sentResult.score * 100).toFixed(2)}%</div>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">Result will appear here.</p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {tab === "settings" && (
          <Card className="border-0 shadow-lg">
            <CardHeader>
              <SectionHeader title="Settings & Diagnostics" subtitle="Customize models, theme, and run quick tests" icon={<Settings className="h-5 w-5" />} />
            </CardHeader>
            <CardContent>
              <div className="grid gap-6 md:grid-cols-2">
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium mb-1">Theme</label>
                    <div className="flex gap-2">
                      <Button variant={settings.theme === "light" ? "default" : "secondary"} onClick={()=>setSettings(s=>({...s, theme: "light"}))}>Light</Button>
                      <Button variant={settings.theme === "dark" ? "default" : "secondary"} onClick={()=>setSettings(s=>({...s, theme: "dark"}))}>Dark</Button>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <input id="tts" type="checkbox" className="h-4 w-4" checked={settings.tts} onChange={(e)=>setSettings(s=>({...s, tts: e.target.checked}))} />
                    <label htmlFor="tts" className="text-sm">Enable text-to-speech for assistant replies</label>
                  </div>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium mb-1">Chat model</label>
                    <Input value={settings.models.chat} onChange={(e)=>setSettings(s=>({...s, models:{...s.models, chat: e.target.value}}))} />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Summarizer model</label>
                    <Input value={settings.models.summarize} onChange={(e)=>setSettings(s=>({...s, models:{...s.models, summarize: e.target.value}}))} />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Sentiment model</label>
                    <Input value={settings.models.sentiment} onChange={(e)=>setSettings(s=>({...s, models:{...s.models, sentiment: e.target.value}}))} />
                  </div>
                  <div className="flex gap-2">
                    <Button variant="secondary" onClick={()=>setSettings(s=>({ ...s, models: { chat: MODEL_CATALOG.chat.model, summarize: MODEL_CATALOG.summarize.model, sentiment: MODEL_CATALOG.sentiment.model }}))}>Reset models</Button>
                    <Button onClick={()=>{ chatPipeRef.current=null; sumPipeRef.current=null; sentPipeRef.current=null; }}>Reload models on next use</Button>
                  </div>
                </div>
              </div>

              <div className="mt-6 rounded-2xl border p-3">
                <div className="flex items-center justify-between mb-3">
                  <div className="text-sm font-medium">Diagnostics</div>
                  <Button variant="outline" onClick={runSelfTests}>Run self-tests</Button>
                </div>
                {testResults ? (
                  <ul className="space-y-1 text-sm">
                    {testResults.map((t, i) => (
                      <li key={i} className={cn("flex items-start justify-between", t.ok ? "text-green-600" : "text-red-600")}> 
                        <span>{t.ok ? "✅" : "❌"} {t.name}</span>
                        {!t.ok && t.detail && <span className="ml-3 text-xs text-muted-foreground">{t.detail}</span>}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">No tests run yet.</p>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        <footer className="mt-8 text-center text-xs text-muted-foreground">
          <p>Made with ❤️ — TITANS AI. 100% client-side. Swap models in Settings to upgrade quality.</p>
        </footer>
      </main>

      <style>{`
        .hide-scrollbar::-webkit-scrollbar { display: none; }
        .hide-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>
    </div>
  );
}
