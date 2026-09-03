"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  PhoneOff,
  Volume2,
  Sparkles,
  ShieldCheck,
  Send,
  Timer
} from "lucide-react";

interface Message {
  role: "user" | "assistant";
  text: string;
}

export default function EnterpriseInterviewPage() {
  const [hasStarted, setHasStarted] = useState(false);
  const [isMicOn, setIsMicOn] = useState(true);
  const [isVideoOn, setIsVideoOn] = useState(true);
  const [isAiSpeaking, setIsAiSpeaking] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [status, setStatus] = useState("System Ready");
  const [seconds, setSeconds] = useState(0);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recognitionRef = useRef<any>(null);

  // Session timer
  useEffect(() => {
    let t: any;
    if (hasStarted) {
      t = setInterval(() => setSeconds((s) => s + 1), 1000);
    }
    return () => clearInterval(t);
  }, [hasStarted]);

  const timerText = `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;

  // Camera & Mic setup (Zero echo)
  const initHardware = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: "user" },
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.muted = true; // Crucial: Prevents hearing self voice
      }
    } catch (e) {
      console.warn("Media devices warning:", e);
    }
  };

  // Speech-To-Text
  const setupSpeechRecognition = () => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) return;

    const reco = new SpeechRecognition();
    reco.continuous = true;
    reco.interimResults = true;
    reco.lang = "en-US";

    reco.onstart = () => {
      setIsListening(true);
      setStatus("Listening to your response...");
    };

    reco.onresult = (event: any) => {
      let current = "";
      for (let i = 0; i < event.results.length; i++) {
        current += event.results[i][0].transcript;
      }
      setTranscript(current);
    };

    reco.onerror = () => {
      setIsListening(false);
      setStatus("Tap 'Speak' to answer");
    };

    reco.onend = () => {
      setIsListening(false);
    };

    recognitionRef.current = reco;
  };

  const startSession = async () => {
    await initHardware();
    setupSpeechRecognition();
    setHasStarted(true);

    const intro = "Welcome to your InternAdda Technical Interview. Let us begin. Could you introduce yourself and mention the most challenging project you have worked on?";
    setMessages([{ role: "assistant", text: intro }]);
    speakTTS(intro);
  };

  // TTS Output
  const speakTTS = (text: string) => {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();

    // Pause mic listening while AI speaks to avoid capturing own audio
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch (_) {}
    }

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.0;
    utterance.pitch = 1.0;

    utterance.onstart = () => {
      setIsAiSpeaking(true);
      setStatus("Interviewer is speaking...");
    };

    utterance.onend = () => {
      setIsAiSpeaking(false);
      setStatus("Your turn to speak");
      // Auto-start listening after AI finishes speaking
      setTimeout(() => {
        if (recognitionRef.current && isMicOn) {
          try { recognitionRef.current.start(); } catch (_) {}
        }
      }, 300);
    };

    window.speechSynthesis.speak(utterance);
  };

  const handleSendAnswer = async () => {
    if (!transcript.trim()) return;
    const currentInput = transcript;
    setTranscript("");

    const updated = [...messages, { role: "user" as const, text: currentInput }];
    setMessages(updated);
    setStatus("Analyzing response...");

    try {
      const res = await fetch("/api/interview/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          history: messages,
          userSpeech: currentInput,
          role: "Full Stack Engineer",
        }),
      });

      const data = await res.json();
      if (data?.text) {
        setMessages([...updated, { role: "assistant", text: data.text }]);
        speakTTS(data.text);
      }
    } catch (err) {
      speakTTS("That sounds reasonable. How do you approach error handling and fault tolerance in such an architecture?");
    }
  };

  const toggleMic = () => {
    if (streamRef.current) {
      const track = streamRef.current.getAudioTracks()[0];
      if (track) {
        track.enabled = !track.enabled;
        setIsMicOn(track.enabled);
      }
    }
  };

  const toggleVideo = () => {
    if (streamRef.current) {
      const track = streamRef.current.getVideoTracks()[0];
      if (track) {
        track.enabled = !track.enabled;
        setIsVideoOn(track.enabled);
      }
    }
  };

  const endInterview = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
    }
    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    setHasStarted(false);
  };

  return (
    <div className="h-[100dvh] w-full bg-[#06080E] text-slate-100 flex flex-col justify-between overflow-hidden select-none">
      {/* Top Header */}
      <header className="h-14 border-b border-slate-800/80 px-4 sm:px-6 flex items-center justify-between bg-[#0B0F19]/80 backdrop-blur-md shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="h-7 w-7 rounded-lg bg-indigo-600 flex items-center justify-center font-bold text-xs shadow-md shadow-indigo-500/20">
            IA
          </div>
          <span className="text-xs font-semibold tracking-tight text-slate-200">
            InternAdda Executive AI
          </span>
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" /> Live
          </span>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-900 border border-slate-800 text-xs font-mono text-slate-300">
            <Timer className="w-3.5 h-3.5 text-indigo-400" />
            <span>{timerText}</span>
          </div>
          {hasStarted && (
            <button
              onClick={endInterview}
              className="px-3 py-1 rounded-md bg-rose-600/10 border border-rose-500/30 text-rose-400 hover:bg-rose-600 hover:text-white text-xs font-medium transition-all"
            >
              End Session
            </button>
          )}
        </div>
      </header>

      {/* Main Interactive Stage */}
      <main className="flex-1 max-w-5xl w-full mx-auto p-4 sm:p-6 flex flex-col justify-center items-center relative overflow-hidden">
        {!hasStarted ? (
          <div className="max-w-md w-full bg-[#0E1320] border border-slate-800/90 rounded-2xl p-6 sm:p-8 text-center shadow-2xl space-y-6">
            <div className="w-14 h-14 mx-auto rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
              <Sparkles className="w-7 h-7" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white tracking-tight">AI Assessment Suite</h2>
              <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
                Adaptive real-time interview assessment. Calibrated for modern engineering standards.
              </p>
            </div>
            <div className="p-3 bg-slate-950/60 rounded-xl border border-slate-800/80 text-left text-[11px] text-slate-400 space-y-1.5">
              <div className="flex items-center gap-1.5 text-slate-200 font-medium">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" /> Noise & Echo Suppression Enabled
              </div>
              <p>• Speak naturally into your mic; turns advance seamlessly.</p>
            </div>
            <button
              onClick={startSession}
              className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs tracking-wide rounded-xl shadow-lg shadow-indigo-600/30 transition-all active:scale-98"
            >
              Start Technical Evaluation
            </button>
          </div>
        ) : (
          <div className="w-full h-full flex flex-col justify-between items-center relative">
            {/* Candidate PiP Camera */}
            <div className="absolute top-0 right-0 w-28 sm:w-44 aspect-video rounded-xl overflow-hidden border border-slate-800 shadow-xl bg-black z-20">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover scale-x-[-1]"
              />
              {!isVideoOn && (
                <div className="absolute inset-0 bg-slate-900 flex items-center justify-center text-[10px] font-mono text-slate-500">
                  Cam Off
                </div>
              )}
            </div>

            {/* AI Center Orb Animation */}
            <div className="flex-1 flex flex-col items-center justify-center my-auto space-y-6 text-center max-w-xl px-2">
              <div className="relative">
                <div
                  className={`w-32 h-32 sm:w-40 sm:h-40 rounded-full flex items-center justify-center transition-all duration-700 ${
                    isAiSpeaking
                      ? "bg-gradient-to-tr from-indigo-500 to-purple-600 ring-8 ring-indigo-500/20 shadow-2xl shadow-indigo-500/40 scale-105"
                      : isListening
                      ? "bg-emerald-500/20 ring-4 ring-emerald-500/30"
                      : "bg-slate-800/80 ring-2 ring-slate-800"
                  }`}
                >
                  <div className="w-28 h-28 sm:w-36 sm:h-36 rounded-full bg-[#070A12] flex items-center justify-center">
                    {isAiSpeaking ? (
                      <Volume2 className="w-8 h-8 text-indigo-400 animate-pulse" />
                    ) : (
                      <Sparkles className={`w-8 h-8 ${isListening ? "text-emerald-400 animate-pulse" : "text-slate-500"}`} />
                    )}
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <div className="text-[11px] font-mono uppercase tracking-wider text-indigo-400">
                  {status}
                </div>
                <p className="text-sm sm:text-base font-medium text-slate-200 leading-relaxed min-h-[48px]">
                  {messages[messages.length - 1]?.role === "assistant"
                    ? messages[messages.length - 1]?.text
                    : "Processing your response..."}
                </p>
              </div>
            </div>

            {/* Live Subtitle Transcript Bar */}
            <div className="w-full max-w-2xl bg-slate-900/90 border border-slate-800 rounded-xl p-3.5 backdrop-blur-md flex items-center justify-between gap-3 shadow-lg mb-2">
              <p className="text-xs text-slate-300 italic truncate flex-1">
                {transcript || (isListening ? "Listening to your answer..." : "Mic ready. Tap Speak below.")}
              </p>
              {transcript.length > 0 && (
                <button
                  onClick={handleSendAnswer}
                  className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow-md shadow-indigo-600/30 transition-all"
                >
                  <span>Submit</span>
                  <Send className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>
        )}
      </main>

      {/* Bottom Floating Controls */}
      {hasStarted && (
        <footer className="h-16 border-t border-slate-800/80 bg-[#0B0F19]/90 backdrop-blur-md px-6 flex items-center justify-center gap-4 shrink-0">
          <button
            onClick={toggleMic}
            className={`p-3 rounded-full border transition-all ${
              isMicOn
                ? "bg-slate-800/80 border-slate-700 text-slate-200"
                : "bg-rose-500/10 border-rose-500/30 text-rose-400"
            }`}
          >
            {isMicOn ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
          </button>

          <button
            onClick={toggleVideo}
            className={`p-3 rounded-full border transition-all ${
              isVideoOn
                ? "bg-slate-800/80 border-slate-700 text-slate-200"
                : "bg-rose-500/10 border-rose-500/30 text-rose-400"
            }`}
          >
            {isVideoOn ? <Video className="w-4 h-4" /> : <VideoOff className="w-4 h-4" />}
          </button>

          <button
            onClick={() => {
              if (recognitionRef.current && !isListening && !isAiSpeaking) {
                try { recognitionRef.current.start(); } catch (_) {}
              }
            }}
            disabled={isAiSpeaking}
            className={`px-5 py-2.5 rounded-full text-xs font-semibold tracking-wide transition-all shadow-md ${
              isListening
                ? "bg-emerald-600 text-white animate-pulse shadow-emerald-500/20"
                : isAiSpeaking
                ? "bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700"
                : "bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-600/30"
            }`}
          >
            {isListening ? "Listening..." : isAiSpeaking ? "Interviewer Speaking" : "Tap to Speak"}
          </button>

          <button
            onClick={endInterview}
            className="p-3 rounded-full bg-rose-600 hover:bg-rose-500 text-white transition-all shadow-md shadow-rose-600/20"
          >
            <PhoneOff className="w-4 h-4" />
          </button>
        </footer>
      )}
    </div>
  );
}
