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
  AlertCircle,
  Clock,
  ShieldCheck
} from "lucide-react";

interface Message {
  role: "user" | "assistant";
  text: string;
}

export default function AIInterviewArena() {
  const [hasStarted, setHasStarted] = useState(false);
  const [isMicOn, setIsMicOn] = useState(true);
  const [isVideoOn, setIsVideoOn] = useState(true);
  const [isAiSpeaking, setIsAiSpeaking] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [statusText, setStatusText] = useState("Ready to begin");
  const [timerSeconds, setTimerSeconds] = useState(0);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recognitionRef = useRef<any>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const [audioLevel, setAudioLevel] = useState(0);

  // Timer logic
  useEffect(() => {
    let interval: any;
    if (hasStarted) {
      interval = setInterval(() => setTimerSeconds((s) => s + 1), 1000);
    }
    return () => clearInterval(interval);
  }, [hasStarted]);

  const formatTimer = (total: number) => {
    const mins = Math.floor(total / 60);
    const secs = total % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  // Camera & Mic setup (ECHO-FREE)
  const initializeMedia = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 1280, height: 720, facingMode: "user" },
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      });
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.muted = true; // CRITICAL: Mute local video to prevent feedback echo!
      }

      // Mic level visualizer without routing to speakers
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 64;
      source.connect(analyser); // DO NOT connect analyser to audioCtx.destination!
      audioContextRef.current = audioCtx;
      analyserRef.current = analyser;

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      const updateLevel = () => {
        if (analyserRef.current) {
          analyserRef.current.getByteFrequencyData(dataArray);
          const avg = dataArray.reduce((p, c) => p + c, 0) / bufferLength;
          setAudioLevel(avg);
        }
        requestAnimationFrame(updateLevel);
      };
      updateLevel();
    } catch (err) {
      console.error("Camera/Mic Permission error:", err);
      alert("Please grant Camera and Microphone access to enter the interview arena.");
    }
  };

  // Web Speech Recognition
  const initSpeechRecognition = () => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      alert("Speech recognition is not supported in this browser. Please use Google Chrome or Edge.");
      return;
    }

    const reco = new SpeechRecognition();
    reco.continuous = false;
    reco.interimResults = true;
    reco.lang = "en-US";

    reco.onstart = () => {
      setIsListening(true);
      setStatusText("Listening to your answer...");
    };

    reco.onresult = (e: any) => {
      let current = "";
      for (let i = 0; i < e.results.length; i++) {
        current += e.results[i][0].transcript;
      }
      setTranscript(current);
    };

    reco.onerror = (e: any) => {
      console.warn("Speech error:", e.error);
      setIsListening(false);
      setStatusText("Mic idle. Click 'Speak' to answer.");
    };

    reco.onend = () => {
      setIsListening(false);
    };

    recognitionRef.current = reco;
  };

  const startInterview = async () => {
    await initializeMedia();
    initSpeechRecognition();
    setHasStarted(true);

    const welcome = "Welcome to InternAdda's Technical Assessment. I will be your evaluator today. To start, walk me through a complex technical challenge you recently solved.";
    setMessages([{ role: "assistant", text: welcome }]);
    speakAiResponse(welcome);
  };

  // AI Voice output using clean SpeechSynthesis
  const speakAiResponse = (text: string) => {
    if (!("speechSynthesis" in window)) return;

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.0;
    utterance.pitch = 1.0;

    // Pick a natural English voice
    const voices = window.speechSynthesis.getVoices();
    const naturalVoice = voices.find((v) => v.lang.startsWith("en") && (v.name.includes("Natural") || v.name.includes("Google") || v.name.includes("Samantha")));
    if (naturalVoice) utterance.voice = naturalVoice;

    utterance.onstart = () => {
      setIsAiSpeaking(true);
      setStatusText("Interviewer is speaking...");
      // Stop recognition while AI speaks to prevent feedback
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch (_) {}
      }
    };

    utterance.onend = () => {
      setIsAiSpeaking(false);
      setStatusText("Your turn. Click 'Speak' or start talking.");
    };

    window.speechSynthesis.speak(utterance);
  };

  // Send answer to Gemini API
  const submitAnswer = async () => {
    if (!transcript.trim()) return;

    const userText = transcript;
    setTranscript("");
    const updatedHistory: Message[] = [...messages, { role: "user", text: userText }];
    setMessages(updatedHistory);
    setStatusText("Evaluating response...");

    try {
      const res = await fetch("/api/interview/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          history: messages,
          userSpeech: userText,
          role: "Full Stack Engineer",
          round: "Technical Interview"
        })
      });

      const data = await res.json();
      if (data.text) {
        const nextAiMsg: Message = { role: "assistant", text: data.text };
        setMessages([...updatedHistory, nextAiMsg]);
        speakAiResponse(data.text);
      } else {
        throw new Error("Invalid response");
      }
    } catch (err) {
      console.error(err);
      setStatusText("Connection glitch. Retrying...");
      speakAiResponse("I heard your point. Let us continue. Can you expand on how you handled performance optimizations in that system?");
    }
  };

  const toggleMic = () => {
    if (streamRef.current) {
      const audioTrack = streamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsMicOn(audioTrack.enabled);
      }
    }
  };

  const toggleVideo = () => {
    if (streamRef.current) {
      const videoTrack = streamRef.current.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setIsVideoOn(videoTrack.enabled);
      }
    }
  };

  const triggerListening = () => {
    if (recognitionRef.current && !isListening && !isAiSpeaking) {
      try {
        recognitionRef.current.start();
      } catch (e) {
        console.warn(e);
      }
    }
  };

  const endSession = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
    }
    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    setHasStarted(false);
  };

  return (
    <div className="min-h-screen bg-[#090A0F] text-slate-100 flex flex-col justify-between font-sans selection:bg-indigo-500 selection:text-white">
      {/* Top Navigation Bar */}
      <header className="border-b border-slate-800/80 bg-[#090A0F]/90 backdrop-blur-md px-6 py-4 flex items-center justify-between sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-500 flex items-center justify-center font-bold text-sm tracking-wider shadow-lg shadow-indigo-500/20">
            IA
          </div>
          <div>
            <h1 className="text-sm font-semibold tracking-tight text-white flex items-center gap-2">
              InternAdda AI Evaluation Arena
              <span className="text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded-full font-mono uppercase tracking-wider">
                Live Session
              </span>
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 bg-slate-900 border border-slate-800 px-3 py-1.5 rounded-lg text-xs font-mono text-slate-300">
            <Clock className="w-3.5 h-3.5 text-indigo-400" />
            <span>{formatTimer(timerSeconds)}</span>
          </div>
          <div className="hidden sm:flex items-center gap-1.5 text-xs text-slate-400">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span>Encrypted Stream</span>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        {!hasStarted ? (
          /* Pre-Interview Onboarding Card */
          <div className="lg:col-span-12 flex items-center justify-center min-h-[70vh]">
            <div className="max-w-xl w-full bg-slate-900/60 border border-slate-800/80 p-8 sm:p-10 rounded-2xl shadow-2xl backdrop-blur-xl text-center space-y-6">
              <div className="mx-auto w-14 h-14 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
                <Sparkles className="w-7 h-7" />
              </div>
              <div>
                <h2 className="text-2xl font-bold text-white tracking-tight">Executive Mock Evaluation</h2>
                <p className="text-sm text-slate-400 mt-2 leading-relaxed">
                  Real-time conversational assessment powered by AI. Check your camera, position your microphone, and begin whenever you are ready.
                </p>
              </div>

              <div className="bg-slate-950/60 border border-slate-800/60 rounded-xl p-4 text-left text-xs text-slate-400 space-y-2">
                <div className="flex items-center gap-2 text-slate-200 font-medium">
                  <AlertCircle className="w-4 h-4 text-indigo-400" /> Key Guidelines:
                </div>
                <p>• Speak naturally after the interviewer finishes asking the question.</p>
                <p>• Zero echo cancellation ensures no self-feedback noise.</p>
                <p>• Your score report will be generated immediately after completion.</p>
              </div>

              <button
                onClick={startInterview}
                className="w-full py-3.5 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-sm rounded-xl transition-all shadow-lg shadow-indigo-600/30 active:scale-[0.99]"
              >
                Join Interview Arena
              </button>
            </div>
          </div>
        ) : (
          /* Live Interview Stage */
          <>
            {/* Left/Main Column: AI Persona & Realtime Feed */}
            <div className="lg:col-span-8 flex flex-col justify-between bg-slate-900/40 border border-slate-800/80 rounded-2xl p-6 relative overflow-hidden backdrop-blur-md min-h-[500px]">
              {/* Interviewer Persona Stage */}
              <div className="flex flex-col items-center justify-center flex-1 my-auto text-center space-y-6">
                <div className="relative">
                  {/* Glowing dynamic ring based on speaking status */}
                  <div
                    className={`w-32 h-32 sm:w-40 sm:h-40 rounded-full flex items-center justify-center transition-all duration-500 ${
                      isAiSpeaking
                        ? "bg-gradient-to-tr from-indigo-600 to-violet-500 ring-8 ring-indigo-500/20 shadow-2xl shadow-indigo-500/40 scale-105"
                        : "bg-slate-800 ring-4 ring-slate-800/50"
                    }`}
                  >
                    <div className="w-28 h-28 sm:w-36 sm:h-36 rounded-full bg-[#0B0D14] flex items-center justify-center">
                      <Sparkles
                        className={`w-10 h-10 transition-colors duration-300 ${
                          isAiSpeaking ? "text-indigo-400 animate-pulse" : "text-slate-500"
                        }`}
                      />
                    </div>
                  </div>

                  {isAiSpeaking && (
                    <span className="absolute bottom-1 right-1 bg-indigo-500 text-white p-2 rounded-full shadow-lg animate-bounce">
                      <Volume2 className="w-4 h-4" />
                    </span>
                  )}
                </div>

                <div className="max-w-xl space-y-2">
                  <span className="text-[11px] font-mono tracking-widest uppercase text-slate-500">
                    {statusText}
                  </span>
                  <p className="text-base sm:text-lg text-slate-200 font-medium leading-relaxed">
                    {messages[messages.length - 1]?.role === "assistant"
                      ? messages[messages.length - 1]?.text
                      : "Thinking..."}
                  </p>
                </div>
              </div>

              {/* Candidate PIP Camera Box */}
              <div className="absolute top-4 right-4 w-32 sm:w-48 aspect-video rounded-xl overflow-hidden border border-slate-700/80 bg-black shadow-xl">
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted // Prevents candidate from hearing their own mic echo!
                  className="w-full h-full object-cover mirror"
                />
                {!isVideoOn && (
                  <div className="absolute inset-0 bg-slate-900 flex items-center justify-center text-slate-400 text-xs font-mono">
                    Cam Off
                  </div>
                )}
                {/* Audio visualizer bar */}
                <div
                  className="absolute bottom-0 left-0 h-1 bg-emerald-500 transition-all duration-75"
                  style={{ width: `${Math.min(100, (audioLevel / 128) * 100)}%` }}
                />
              </div>

              {/* Real-time Subtitle / Candidate Transcript Preview */}
              <div className="mt-4 bg-slate-950/60 border border-slate-800/80 p-4 rounded-xl flex items-center justify-between gap-4">
                <div className="flex-1">
                  <span className="text-[10px] uppercase font-mono text-slate-500 block mb-1">
                    Your Response
                  </span>
                  <p className="text-sm text-slate-300 italic min-h-[20px]">
                    {transcript || (isListening ? "Listening..." : "Click 'Start Speaking' below to answer.")}
                  </p>
                </div>
                {transcript && (
                  <button
                    onClick={submitAnswer}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white rounded-lg transition-all shrink-0"
                  >
                    Submit Answer
                  </button>
                )}
              </div>
            </div>

            {/* Right Column: Dynamic Transcript & Notes */}
            <div className="lg:col-span-4 bg-slate-900/40 border border-slate-800/80 rounded-2xl p-5 flex flex-col justify-between backdrop-blur-md h-[550px] lg:h-auto">
              <div>
                <h3 className="text-xs font-mono uppercase tracking-wider text-slate-400 mb-4 pb-2 border-b border-slate-800">
                  Live Exchange Log
                </h3>
                <div className="space-y-4 overflow-y-auto max-h-[420px] pr-2 scrollbar-thin">
                  {messages.map((m, idx) => (
                    <div
                      key={idx}
                      className={`text-xs p-3 rounded-xl leading-relaxed ${
                        m.role === "assistant"
                          ? "bg-slate-800/60 text-slate-200 border border-slate-700/50"
                          : "bg-indigo-600/10 text-indigo-200 border border-indigo-500/20 ml-4"
                      }`}
                    >
                      <span className="font-semibold block text-[10px] uppercase font-mono mb-1 text-slate-400">
                        {m.role === "assistant" ? "Interviewer" : "You"}
                      </span>
                      {m.text}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </>
        )}
      </main>

      {/* Bottom Floating Control Dock */}
      {hasStarted && (
        <footer className="border-t border-slate-800/80 bg-[#090A0F]/90 backdrop-blur-lg px-6 py-4">
          <div className="max-w-2xl mx-auto flex items-center justify-center gap-4 sm:gap-6">
            <button
              onClick={toggleMic}
              className={`p-3.5 rounded-full border transition-all ${
                isMicOn
                  ? "bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700"
                  : "bg-red-500/10 border-red-500/30 text-red-400 hover:bg-red-500/20"
              }`}
            >
              {isMicOn ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
            </button>

            <button
              onClick={toggleVideo}
              className={`p-3.5 rounded-full border transition-all ${
                isVideoOn
                  ? "bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700"
                  : "bg-red-500/10 border-red-500/30 text-red-400 hover:bg-red-500/20"
              }`}
            >
              {isVideoOn ? <Video className="w-5 h-5" /> : <VideoOff className="w-5 h-5" />}
            </button>

            <button
              onClick={triggerListening}
              disabled={isAiSpeaking}
              className={`px-6 py-3.5 rounded-full text-xs font-semibold tracking-wide transition-all shadow-md ${
                isListening
                  ? "bg-emerald-600 text-white animate-pulse"
                  : isAiSpeaking
                  ? "bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700"
                  : "bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-600/30"
              }`}
            >
              {isListening ? "Listening..." : isAiSpeaking ? "Interviewer Speaking" : "Click to Speak"}
            </button>

            <button
              onClick={endSession}
              className="p-3.5 rounded-full bg-red-600 hover:bg-red-500 text-white transition-all shadow-lg shadow-red-600/20"
            >
              <PhoneOff className="w-5 h-5" />
            </button>
          </div>
        </footer>
      )}
    </div>
  );
}
