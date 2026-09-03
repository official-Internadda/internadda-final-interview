'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  Clock,
  Sparkles,
  ShieldCheck,
  Radio,
  Video,
  AlertTriangle,
  Lock,
  X,
  Bug,
  Image as ImageIcon,
  ChevronRight,
  Keyboard,
  Zap,
  ZapOff,
  RotateCcw
} from 'lucide-react';
import { Interview, CandidateAttempt, FraudFlag, TranscriptEntry, SessionPhase } from '@/lib/types';
import { ProctoringMonitor } from './proctoring-monitor';

interface LiveInterviewProps {
  interview: Interview;
  attempt: CandidateAttempt;
  mediaStream: MediaStream | null;
  onFinish: (disqualified?: boolean, flags?: FraudFlag[]) => void;
}

type VoiceState = 'idle' | 'ai_speaking' | 'listening' | 'processing';

// How long (ms) to wait after the candidate stops talking before we
// auto-submit their answer, when "Auto-submit" mode is enabled.
const SILENCE_AUTO_SUBMIT_MS = 2800;

export function LiveInterview({
  interview,
  attempt,
  mediaStream,
  onFinish
}: LiveInterviewProps) {
  // Session State
  const [currentPhase, setCurrentPhase] = useState<SessionPhase>('greeting');
  const [questionTurnCount, setQuestionTurnCount] = useState(0);
  const [aiMessage, setAiMessage] = useState('');
  const [contextHint, setContextHint] = useState('');
  const [candidateAnswer, setCandidateAnswer] = useState('');
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const [isAudioMuted, setIsAudioMuted] = useState(false);
  const [showImage, setShowImage] = useState(false);
  const [imageUrl, setImageUrl] = useState<string | undefined>(undefined);

  // Semi-automatic controls: this is the main fix for "voice doesn't work
  // reliably" — the candidate is always in control of when an answer is
  // actually submitted, and can always fall back to typing.
  const [sttSupported, setSttSupported] = useState(true);
  const [micError, setMicError] = useState<string | null>(null);
  const [autoSubmitEnabled, setAutoSubmitEnabled] = useState(false);
  const [autoListenEnabled, setAutoListenEnabled] = useState(true);
  const [silenceCountdown, setSilenceCountdown] = useState<number | null>(null);

  // Transcript History
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [fraudFlags, setFraudFlags] = useState<FraudFlag[]>([]);

  // Dev Debug Panel & Telemetry
  const [showDebug, setShowDebug] = useState(false);
  const [activeProvider, setActiveProvider] = useState<'groq' | 'gemini' | 'openrouter' | 'static_fallback'>('groq');
  const [lastApiError, setLastApiError] = useState<string | null>(null);

  // Soft Overall Session Timer (Total session duration, e.g. 15 mins)
  const [totalSecondsLeft, setTotalSecondsLeft] = useState(interview.duration_minutes * 60);

  // Loading / Processing State
  const [loadingTurn, setLoadingTurn] = useState(true);

  // Refs
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const recognitionRef = useRef<any>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const voiceStateRef = useRef<VoiceState>('idle');
  const silenceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const countdownIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const manualStopRef = useRef<boolean>(true); // true = recognition should NOT auto-restart
  const isRecognizingRef = useRef<boolean>(false);
  const autoSubmitEnabledRef = useRef(autoSubmitEnabled);
  const autoListenEnabledRef = useRef(autoListenEnabled);
  const isAudioMutedRef = useRef(isAudioMuted);
  const candidateAnswerRef = useRef('');
  const cachedVoicesRef = useRef<SpeechSynthesisVoice[]>([]);

  // Keep refs in sync with the state they mirror (avoids stale closures
  // inside the SpeechRecognition event handlers, which are attached once).
  useEffect(() => {
    voiceStateRef.current = voiceState;
  }, [voiceState]);
  useEffect(() => {
    autoSubmitEnabledRef.current = autoSubmitEnabled;
  }, [autoSubmitEnabled]);
  useEffect(() => {
    autoListenEnabledRef.current = autoListenEnabled;
  }, [autoListenEnabled]);
  useEffect(() => {
    isAudioMutedRef.current = isAudioMuted;
  }, [isAudioMuted]);
  useEffect(() => {
    candidateAnswerRef.current = candidateAnswer;
  }, [candidateAnswer]);

  // Attach webcam stream to video element
  useEffect(() => {
    if (videoRef.current && mediaStream) {
      videoRef.current.srcObject = mediaStream;
    }
  }, [mediaStream]);

  // Keyboard shortcut Ctrl+Shift+D for dev debug panel
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'd') {
        setShowDebug((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Soft overall session countdown
  useEffect(() => {
    const timer = setInterval(() => {
      setTotalSecondsLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          handleEndSession();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Initialize Web Audio Analyser for Audio Orb Canvas
  useEffect(() => {
    if (!mediaStream) return;

    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) {
        const ctx = new AudioCtx();
        audioContextRef.current = ctx;
        const source = ctx.createMediaStreamSource(mediaStream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 128;
        source.connect(analyser);
        analyserRef.current = analyser;
      }
    } catch (err) {
      console.error('AudioContext setup error:', err);
    }

    return () => {
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, [mediaStream]);

  // Canvas Audio Orb Visualizer Animation Loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let pulseAngle = 0;
    const dataArray = new Uint8Array(64);

    const renderOrb = () => {
      const width = canvas.width;
      const height = canvas.height;
      const centerX = width / 2;
      const centerY = height / 2;

      ctx.clearRect(0, 0, width, height);

      let amplitude = 0;
      if (analyserRef.current && voiceStateRef.current === 'listening') {
        analyserRef.current.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
        amplitude = sum / dataArray.length;
      }

      pulseAngle += 0.04;
      const baseRadius = 48 + Math.sin(pulseAngle) * 4;
      const activeRadius = baseRadius + (amplitude / 255) * 40;

      // Draw Outer Glow Rings
      const ringColor =
        voiceStateRef.current === 'ai_speaking'
          ? 'rgba(37, 99, 235, 0.2)'
          : voiceStateRef.current === 'listening'
          ? 'rgba(16, 185, 129, 0.25)'
          : 'rgba(100, 116, 139, 0.15)';

      ctx.beginPath();
      ctx.arc(centerX, centerY, activeRadius + 16, 0, Math.PI * 2);
      ctx.fillStyle = ringColor;
      ctx.fill();

      // Draw Inner Pulsing Orb
      const orbGradient = ctx.createRadialGradient(
        centerX - 10,
        centerY - 10,
        5,
        centerX,
        centerY,
        activeRadius
      );

      if (voiceStateRef.current === 'ai_speaking') {
        orbGradient.addColorStop(0, '#60A5FA');
        orbGradient.addColorStop(1, '#2563EB');
      } else if (voiceStateRef.current === 'listening') {
        orbGradient.addColorStop(0, '#34D399');
        orbGradient.addColorStop(1, '#059669');
      } else if (voiceStateRef.current === 'processing') {
        orbGradient.addColorStop(0, '#FBBF24');
        orbGradient.addColorStop(1, '#D97706');
      } else {
        orbGradient.addColorStop(0, '#94A3B8');
        orbGradient.addColorStop(1, '#475569');
      }

      ctx.beginPath();
      ctx.arc(centerX, centerY, activeRadius, 0, Math.PI * 2);
      ctx.fillStyle = orbGradient;
      ctx.fill();

      // Sound Wave Ripples when listening
      if (voiceStateRef.current === 'listening' && amplitude > 10) {
        ctx.beginPath();
        ctx.arc(centerX, centerY, activeRadius + 8 + (amplitude / 255) * 20, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(16, 185, 129, 0.6)';
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      animFrameRef.current = requestAnimationFrame(renderOrb);
    };

    renderOrb();

    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, []);

  // ---------------------------------------------------------------------
  // Speech-to-Text (STT) setup.
  //
  // The browser Web Speech API (SpeechRecognition) is only reliably
  // available in Chromium-based browsers (Chrome, Edge, Brave, Arc) and
  // is NOT supported in Firefox and is inconsistent in Safari. If it is
  // missing we fall back cleanly to a "type your answer" experience
  // instead of silently doing nothing.
  // ---------------------------------------------------------------------
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const SpeechRecognitionCtor =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognitionCtor) {
      setSttSupported(false);
      setLoadingTurn((v) => v); // no-op, keeps linter happy about deps
      return;
    }

    const recognition = new SpeechRecognitionCtor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onstart = () => {
      isRecognizingRef.current = true;
    };

    recognition.onresult = (event: any) => {
      // Discard results while the AI is talking to avoid the mic
      // "hearing" the AI's own TTS output and creating an echo loop.
      if (voiceStateRef.current === 'ai_speaking') return;

      let currentTranscript = '';
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        currentTranscript += event.results[i][0].transcript;
      }

      if (currentTranscript.trim()) {
        setCandidateAnswer(currentTranscript);
        setMicError(null);
        if (autoSubmitEnabledRef.current) {
          armSilenceCountdown();
        }
      }
    };

    recognition.onerror = (event: any) => {
      const code = event?.error;
      if (code === 'no-speech' || code === 'aborted') {
        // Benign — just a pause in speech, keep listening.
        return;
      }
      if (code === 'not-allowed' || code === 'service-not-allowed') {
        manualStopRef.current = true;
        setMicError('Microphone access was blocked. You can still type your answer below.');
        setVoiceState('idle');
        return;
      }
      if (code === 'audio-capture') {
        manualStopRef.current = true;
        setMicError('No microphone was detected. Please type your answer below.');
        setVoiceState('idle');
        return;
      }
      if (code === 'network') {
        setMicError('Voice recognition network hiccup — you can keep speaking or type instead.');
        return;
      }
      console.warn('Speech recognition error:', code);
    };

    recognition.onend = () => {
      isRecognizingRef.current = false;
      // Only auto-restart if we're still supposed to be listening AND the
      // stop wasn't requested intentionally (prevents restart loops/races
      // that made voice mode feel "stuck" or unresponsive before).
      if (!manualStopRef.current && voiceStateRef.current === 'listening') {
        try {
          recognition.start();
        } catch (e) {
          // Recognition might briefly refuse a restart — retry shortly.
          setTimeout(() => {
            if (!manualStopRef.current && voiceStateRef.current === 'listening') {
              try {
                recognition.start();
              } catch (e2) {
                /* give up silently, candidate can still use the mic button */
              }
            }
          }, 300);
        }
      }
    };

    recognitionRef.current = recognition;

    return () => {
      manualStopRef.current = true;
      try {
        recognition.stop();
      } catch (e) {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Visible countdown before auto-submit fires, so the candidate always
  // sees it coming and can cancel by speaking/typing again.
  const armSilenceCountdown = () => {
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);

    let secondsLeft = Math.ceil(SILENCE_AUTO_SUBMIT_MS / 1000);
    setSilenceCountdown(secondsLeft);

    countdownIntervalRef.current = setInterval(() => {
      secondsLeft -= 1;
      setSilenceCountdown(secondsLeft > 0 ? secondsLeft : null);
      if (secondsLeft <= 0 && countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
      }
    }, 1000);

    silenceTimerRef.current = setTimeout(() => {
      setSilenceCountdown(null);
      if (voiceStateRef.current === 'listening' && candidateAnswerRef.current.trim()) {
        handleCandidateSubmitTurn();
      }
    }, SILENCE_AUTO_SUBMIT_MS);
  };

  const clearSilenceCountdown = () => {
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
    silenceTimerRef.current = null;
    countdownIntervalRef.current = null;
    setSilenceCountdown(null);
  };

  // Start STT Listening (idempotent — safe to call even if already listening)
  const startListening = () => {
    if (!sttSupported || !recognitionRef.current || isAudioMutedRef.current) return;
    manualStopRef.current = false;
    setMicError(null);
    setVoiceState('listening');
    if (isRecognizingRef.current) return; // already running, don't double-start
    try {
      recognitionRef.current.start();
    } catch (err) {
      // "already started" errors are safe to ignore
    }
  };

  // Stop STT Listening — `intentional` prevents the onend handler from
  // automatically restarting recognition right after we asked it to stop.
  const stopListening = (intentional: boolean = true) => {
    manualStopRef.current = intentional;
    clearSilenceCountdown();
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (err) {}
    }
  };

  // Load and cache TTS voices. getVoices() often returns an empty array on
  // the very first call because the voice list loads asynchronously — this
  // waits for the 'voiceschanged' event instead of silently using no voice.
  const getPreferredVoice = (): SpeechSynthesisVoice | undefined => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return undefined;
    let voices = cachedVoicesRef.current;
    if (!voices.length) {
      voices = window.speechSynthesis.getVoices();
      cachedVoicesRef.current = voices;
    }
    return voices.find(
      (v) =>
        v.lang.startsWith('en') &&
        (v.name.includes('Natural') || v.name.includes('Google') || v.name.includes('Samantha') || v.name.includes('Neural'))
    ) || voices.find((v) => v.lang.startsWith('en'));
  };

  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    const loadVoices = () => {
      cachedVoicesRef.current = window.speechSynthesis.getVoices();
    };
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
    return () => {
      window.speechSynthesis.onvoiceschanged = null;
    };
  }, []);

  // Speak AI Message via Web Speech Synthesis (TTS)
  const speakAiMessage = (text: string, onEndCallback?: () => void) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window) || isAudioMutedRef.current) {
      if (onEndCallback) onEndCallback();
      return;
    }

    // Step 1: Explicitly stop recognition to prevent the mic from
    // "hearing" the AI and looping its own words back as an answer.
    stopListening(true);
    window.speechSynthesis.cancel();
    setVoiceState('ai_speaking');

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.0;
    utterance.pitch = 1.0;

    const preferredVoice = getPreferredVoice();
    if (preferredVoice) utterance.voice = preferredVoice;

    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      // Step 2: small buffer after AI stops speaking before the mic
      // re-activates, so the tail of the AI's audio isn't picked up.
      setTimeout(() => {
        setVoiceState('idle');
        if (onEndCallback) {
          onEndCallback();
        } else if (autoListenEnabledRef.current) {
          startListening();
        }
      }, 400);
    };

    utterance.onend = finish;
    utterance.onerror = (err) => {
      console.error('Speech synthesis error:', err);
      finish();
    };

    // Safety-net: some browsers (mobile Safari especially) can silently
    // drop the onend event. Force-resolve after a generous timeout based
    // on message length so the UI never gets stuck on "AI Speaking...".
    const estimatedMs = Math.max(3000, text.length * 90);
    setTimeout(finish, estimatedMs);

    window.speechSynthesis.speak(utterance);
  };

  // Fetch Next Conversational Turn from Backend
  const fetchTurn = async (updatedTranscript: TranscriptEntry[]) => {
    setLoadingTurn(true);
    setVoiceState('processing');
    clearSilenceCountdown();

    try {
      const res = await fetch('/api/interview/generate-question', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          interview_id: interview.id,
          category: interview.category,
          currentPhase,
          transcript: updatedTranscript,
          questionTurnCount,
          totalQuestions: interview.num_questions,
          imageUrl
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to generate conversational turn');

      if (data.provider) setActiveProvider(data.provider);
      setLastApiError(data.errorDetails || null);

      const nextMsg = data.nextMessage || "Let's explore your technical approach further.";
      const nextPhase: SessionPhase = data.phase || currentPhase;
      const isMoveOn = Boolean(data.moveOn);
      const isRejected = Boolean(data.rejectedAnswer);

      setAiMessage(nextMsg);
      setCurrentPhase(nextPhase);
      setContextHint(data.context_hint || '');
      setShowImage(Boolean(data.showImage));
      if (data.imageUrl) setImageUrl(data.imageUrl);

      // Append AI response to running transcript
      const aiEntry: TranscriptEntry = {
        role: 'ai',
        text: nextMsg,
        timestamp: new Date().toLocaleTimeString(),
        phase: nextPhase
      };
      setTranscript((prev) => [...prev, aiEntry]);

      if (isMoveOn && nextPhase === 'questions' && !isRejected) {
        setQuestionTurnCount((prev) => prev + 1);
      }

      setLoadingTurn(false);

      // If static fallback occurred, automatically retry the real LLM call again in the background after 3s
      if (data.provider === 'static_fallback') {
        console.warn('[Static Fallback Triggered] Auto-retrying real LLM turn in background in 3s...');
        setTimeout(() => {
          fetchTurn(updatedTranscript);
        }, 3000);
      }

      // Speak AI response and enable listening upon completion
      speakAiMessage(nextMsg, () => {
        if (nextPhase === 'close') {
          setTimeout(() => handleEndSession(), 3000);
        } else if (autoListenEnabledRef.current) {
          startListening();
        } else {
          setVoiceState('idle');
        }
      });
    } catch (err: any) {
      console.error('Error in fetchTurn:', err);
      setLoadingTurn(false);
      setActiveProvider('static_fallback');
      setLastApiError(err.message || 'Fetch turn network error');

      const fallbackMsg = "I'm having a brief technical moment, one second...";
      setAiMessage(fallbackMsg);

      // Auto-retry in background after 3s
      setTimeout(() => {
        fetchTurn(updatedTranscript);
      }, 3000);

      speakAiMessage(fallbackMsg, () => {
        if (autoListenEnabledRef.current) startListening();
        else setVoiceState('idle');
      });
    }
  };

  // Initial turn load (Greeting phase)
  useEffect(() => {
    fetchTurn([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Submit candidate answer turn
  const handleCandidateSubmitTurn = useCallback(async () => {
    if (voiceStateRef.current === 'processing' || voiceStateRef.current === 'ai_speaking') return;

    const answer = candidateAnswerRef.current.trim();
    if (!answer) return;

    clearSilenceCountdown();
    stopListening(true);
    setCandidateAnswer('');

    // Append Candidate entry to running transcript
    const candEntry: TranscriptEntry = {
      role: 'candidate',
      text: answer,
      timestamp: new Date().toLocaleTimeString(),
      phase: currentPhase
    };

    setTranscript((prevTranscript) => {
      const newTranscript = [...prevTranscript, candEntry];

      // Evaluate answer on backend if in questions phase (fire and forget)
      if (currentPhase === 'questions' && aiMessage) {
        fetch('/api/interview/evaluate-answer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            attempt_id: attempt.id,
            questionIndex: Math.max(1, questionTurnCount),
            question_text: aiMessage,
            candidate_answer: answer,
            category: interview.category
          })
        }).catch((err) => console.error('Error evaluating answer log:', err));
      }

      // Fetch next conversational turn from LLM
      fetchTurn(newTranscript);
      return newTranscript;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPhase, aiMessage, questionTurnCount]);

  // End Session Handler
  const handleEndSession = async () => {
    stopListening(true);
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }

    try {
      await fetch('/api/interview/finish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          attempt_id: attempt.id,
          fraud_flags: fraudFlags,
          disqualified: fraudFlags.length >= 3
        })
      });
    } catch (err) {
      console.error('Error completing session:', err);
    }

    onFinish(fraudFlags.length >= 3, fraudFlags);
  };

  const handleProctoringFlag = (flag: FraudFlag) => {
    setFraudFlags((prev) => [...prev, flag]);
  };

  // Toggle the mic manually — this is the main "semi-automatic" control:
  // the candidate decides exactly when they're speaking.
  const handleMicToggle = () => {
    if (voiceState === 'listening') {
      clearSilenceCountdown();
      stopListening(true);
      setVoiceState('idle');
    } else if (voiceState === 'idle') {
      startListening();
    }
  };

  // Format time remaining
  const minutesLeft = Math.floor(totalSecondsLeft / 60);
  const secondsLeft = totalSecondsLeft % 60;
  const timeFormatted = `${minutesLeft}:${secondsLeft < 10 ? '0' : ''}${secondsLeft}`;

  const canSubmit =
    candidateAnswer.trim().length > 0 && voiceState !== 'processing' && voiceState !== 'ai_speaking';

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-950 text-white overflow-hidden select-none">
      {/* Invisible Proctoring Observer */}
      <ProctoringMonitor
        mediaStream={mediaStream}
        onDisqualify={() => {}}
        onFraudWarning={handleProctoringFlag}
      />

      {/* Top Floating Control Bar (Minimal & Distraction-Free) */}
      <div className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between px-6 py-4 bg-gradient-to-b from-slate-950/90 to-transparent pointer-events-auto">
        <div className="flex items-center gap-3">
          <div className="inline-flex items-center gap-2 rounded-full bg-slate-900/80 border border-slate-800 px-3 py-1 text-xs font-semibold text-slate-300 backdrop-blur-md">
            <Radio className="h-3.5 w-3.5 text-emerald-400 animate-pulse" />
            Live AI Session
          </div>
          <div className="inline-flex items-center gap-1.5 rounded-full bg-slate-900/80 border border-slate-800 px-3 py-1 text-xs font-mono text-slate-400 backdrop-blur-md">
            <Clock className="h-3.5 w-3.5 text-blue-400" />
            {timeFormatted}
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Auto-listen toggle */}
          <button
            onClick={() => setAutoListenEnabled((v) => !v)}
            className="hidden sm:inline-flex items-center gap-1.5 rounded-full bg-slate-900/80 border border-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-400 hover:text-white backdrop-blur-md transition-all"
            title="Auto-open mic after the AI finishes speaking"
          >
            {autoListenEnabled ? <Zap className="h-3.5 w-3.5 text-emerald-400" /> : <ZapOff className="h-3.5 w-3.5" />}
            Auto-listen: {autoListenEnabled ? 'On' : 'Off'}
          </button>

          {/* Auto-submit toggle */}
          <button
            onClick={() => {
              setAutoSubmitEnabled((v) => !v);
              clearSilenceCountdown();
            }}
            className="hidden sm:inline-flex items-center gap-1.5 rounded-full bg-slate-900/80 border border-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-400 hover:text-white backdrop-blur-md transition-all"
            title="Auto-submit your answer a few seconds after you stop talking"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Auto-submit: {autoSubmitEnabled ? 'On' : 'Off'}
          </button>

          {/* Audio Mute Toggle */}
          <button
            onClick={() => setIsAudioMuted(!isAudioMuted)}
            className="p-2.5 rounded-full bg-slate-900/80 border border-slate-800 text-slate-400 hover:text-white backdrop-blur-md transition-all"
            title={isAudioMuted ? 'Unmute Audio' : 'Mute Audio'}
          >
            {isAudioMuted ? <VolumeX className="h-4 w-4 text-rose-400" /> : <Volume2 className="h-4 w-4 text-emerald-400" />}
          </button>

          {/* Dev Debug Toggle */}
          <button
            onClick={() => setShowDebug(!showDebug)}
            className={`p-2.5 rounded-full border backdrop-blur-md transition-all ${
              showDebug ? 'bg-blue-600 text-white border-blue-500' : 'bg-slate-900/80 border-slate-800 text-slate-400 hover:text-white'
            }`}
            title="Toggle Dev Telemetry (Ctrl+Shift+D)"
          >
            <Bug className="h-4 w-4" />
          </button>

          {/* Emergency Exit Control */}
          <button
            onClick={handleEndSession}
            className="flex items-center gap-1.5 rounded-full bg-rose-600/20 hover:bg-rose-600 border border-rose-500/40 px-3.5 py-1.5 text-xs font-semibold text-rose-300 hover:text-white transition-all shadow-md"
          >
            <X className="h-4 w-4" />
            <span>End Session</span>
          </button>
        </div>
      </div>

      {/* Main 2-Zone Split Screen Layout */}
      <div className="flex-1 grid grid-cols-1 md:grid-cols-2 h-full w-full overflow-y-auto">
        {/* ZONE 1: AI INTERVIEWER ZONE (Left on desktop, Top on mobile) */}
        <div className="relative flex flex-col items-center justify-center p-6 bg-slate-900/60 border-b md:border-b-0 md:border-r border-slate-800/80">
          <div className="w-full max-w-md space-y-6 text-center">
            {/* Visualizer Canvas Orb */}
            <div className="relative mx-auto flex items-center justify-center">
              <canvas ref={canvasRef} width={260} height={260} className="w-64 h-64" />

              {/* Status Badge Centered Under Orb */}
              <div className="absolute -bottom-2 inset-x-0 flex justify-center">
                <span className="inline-flex items-center gap-2 rounded-full bg-slate-950/90 border border-slate-800 px-4 py-1 text-xs font-semibold backdrop-blur-md shadow-lg">
                  {voiceState === 'ai_speaking' && (
                    <>
                      <span className="h-2 w-2 rounded-full bg-blue-500 animate-ping"></span>
                      <span className="text-blue-400">AI Interviewer Speaking...</span>
                    </>
                  )}
                  {voiceState === 'listening' && (
                    <>
                      <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse"></span>
                      <span className="text-emerald-400">Listening to Candidate...</span>
                    </>
                  )}
                  {voiceState === 'processing' && (
                    <>
                      <span className="h-2 w-2 rounded-full bg-amber-500 animate-spin"></span>
                      <span className="text-amber-400">Analyzing Response...</span>
                    </>
                  )}
                  {voiceState === 'idle' && (
                    <span className="text-slate-400">AI Ready</span>
                  )}
                </span>
              </div>
            </div>

            {/* AI Spoken Line Text Box */}
            <div className="eightfold-card p-5 bg-slate-950/80 border-slate-800 text-left space-y-2 shadow-xl max-h-44 overflow-y-auto">
              <div className="flex items-center justify-between text-[11px] text-slate-400 border-b border-slate-800 pb-2">
                <span className="font-bold uppercase tracking-wider text-blue-400 flex items-center gap-1.5">
                  <Sparkles className="h-3.5 w-3.5" /> AI Interviewer
                </span>
                <span className="capitalize text-slate-500 font-mono">Phase: {currentPhase}</span>
              </div>
              <p className="text-xs text-slate-200 leading-relaxed font-medium">
                {aiMessage || "Initializing conversation..."}
              </p>
            </div>

            {/* MID-INTERVIEW STOCK IMAGE CURVEBALL MODULE (Inside AI Zone) */}
            {showImage && imageUrl && (
              <div className="eightfold-card p-3 bg-slate-950 border-blue-500/40 space-y-2 shadow-2xl animate-fade-in">
                <div className="flex items-center justify-between text-[11px] font-bold text-blue-400">
                  <span className="flex items-center gap-1.5">
                    <ImageIcon className="h-3.5 w-3.5" /> Visual Observation Round
                  </span>
                  <span className="text-[10px] text-slate-400 font-normal">Describe what you see</span>
                </div>
                <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-slate-800 bg-slate-900">
                  <img src={imageUrl} alt="Observational visual test" className="h-full w-full object-cover" />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ZONE 2: CANDIDATE SELF-VIEW CAMERA ZONE (Right on desktop, Bottom on mobile) */}
        <div className="relative flex flex-col items-center justify-center p-6 bg-slate-950">
          <div className="w-full max-w-md space-y-4">
            {/* Live Camera Box */}
            <div className="relative aspect-video w-full overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="h-full w-full object-cover scale-x-[-1]"
              />

              {/* Status Overlay */}
              <div className="absolute top-3 left-3 flex items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-950/80 border border-slate-800 px-3 py-1 text-[11px] font-semibold text-slate-300 backdrop-blur-md">
                  <Video className="h-3.5 w-3.5 text-blue-400" />
                  Live Self View
                </span>
              </div>

              {/* Fraud Warning Overlay */}
              {fraudFlags.length > 0 && (
                <div className="absolute bottom-3 left-3 right-3 flex items-center gap-2 rounded-xl bg-rose-950/90 border border-rose-500/40 p-2.5 text-[11px] text-rose-300 backdrop-blur-md">
                  <AlertTriangle className="h-4 w-4 shrink-0 text-rose-400" />
                  <span>Proctoring Alert: {fraudFlags[fraudFlags.length - 1].message}</span>
                </div>
              )}
            </div>

            {/* Mic / STT unsupported browser notice */}
            {!sttSupported && (
              <div className="flex items-start gap-2 rounded-xl bg-amber-950/60 border border-amber-500/40 p-3 text-[11px] text-amber-300">
                <Keyboard className="h-4 w-4 shrink-0 mt-0.5" />
                <span>
                  Voice recognition isn't supported in this browser. No problem — just type your answer
                  below. For voice mode, try Chrome or Edge.
                </span>
              </div>
            )}

            {/* Mic permission / runtime error notice */}
            {micError && (
              <div className="flex items-start gap-2 rounded-xl bg-rose-950/60 border border-rose-500/40 p-3 text-[11px] text-rose-300">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{micError}</span>
              </div>
            )}

            {/* Candidate Answer — always editable, works with voice AND typing */}
            <div className="eightfold-card p-4 bg-slate-900/80 border-slate-800 space-y-2 text-left shadow-lg">
              <div className="flex items-center justify-between text-[11px] text-slate-400 border-b border-slate-800 pb-1.5">
                <span className="font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
                  <Mic className="h-3.5 w-3.5" /> Your Answer
                </span>
                <span className="text-[10px] text-slate-500 font-mono">
                  {silenceCountdown ? `Auto-submitting in ${silenceCountdown}s...` : 'Speak, type, or edit freely'}
                </span>
              </div>

              <textarea
                value={candidateAnswer}
                onChange={(e) => {
                  setCandidateAnswer(e.target.value);
                  if (autoSubmitEnabled) clearSilenceCountdown();
                }}
                onFocus={() => clearSilenceCountdown()}
                disabled={voiceState === 'ai_speaking' || voiceState === 'processing'}
                placeholder={
                  voiceState === 'listening'
                    ? 'Listening... speak your answer, or just type it here.'
                    : 'Type your answer, or tap the mic to speak it.'
                }
                rows={3}
                className="w-full resize-none rounded-lg bg-slate-950/60 border border-slate-800 focus:border-emerald-500 focus:outline-none px-3 py-2 text-xs text-slate-200 leading-relaxed disabled:opacity-50"
              />

              <div className="flex items-center gap-2">
                {/* Mic Toggle Button (push-to-talk style, fully candidate-controlled) */}
                {sttSupported && (
                  <button
                    onClick={handleMicToggle}
                    disabled={voiceState === 'ai_speaking' || voiceState === 'processing'}
                    className={`flex items-center justify-center gap-2 rounded-xl py-2 px-4 text-xs font-semibold shadow-md transition-all disabled:opacity-40 ${
                      voiceState === 'listening'
                        ? 'bg-rose-600 hover:bg-rose-500 text-white'
                        : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700'
                    }`}
                  >
                    {voiceState === 'listening' ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                    {voiceState === 'listening' ? 'Stop Mic' : 'Start Mic'}
                  </button>
                )}

                {/* Manual Submit — always available once there's an answer */}
                <button
                  onClick={handleCandidateSubmitTurn}
                  disabled={!canSubmit}
                  className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-500 py-2 text-xs font-semibold text-white shadow-md transition-all disabled:cursor-not-allowed"
                >
                  <span>Submit Answer</span>
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* DEV DEBUG TELEMETRY PANEL (Toggleable via Ctrl+Shift+D or Bug Icon) */}
      {showDebug && (
        <div className="absolute bottom-4 left-4 right-4 z-40 max-w-2xl mx-auto rounded-2xl border border-blue-500/40 bg-slate-900/95 p-4 text-xs text-slate-300 shadow-2xl backdrop-blur-md space-y-3">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <span className="font-bold text-blue-400 flex items-center gap-1.5">
              <Bug className="h-4 w-4" /> Dev Telemetry & Transcript Inspector
            </span>
            <button onClick={() => setShowDebug(false)} className="text-slate-400 hover:text-white">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="grid grid-cols-4 gap-2 text-[11px] font-mono text-slate-400">
            <div>Phase: <span className="text-white">{currentPhase}</span></div>
            <div>Turns: <span className="text-white">{questionTurnCount} / {interview.num_questions}</span></div>
            <div>Provider: <span className={activeProvider === 'groq' ? 'text-emerald-400 font-bold' : activeProvider === 'gemini' || activeProvider === 'openrouter' ? 'text-blue-400 font-bold' : 'text-rose-400 font-bold'}>{activeProvider.toUpperCase()}</span></div>
            <div>Entries: <span className="text-white">{transcript.length}</span></div>
          </div>

          <div className="grid grid-cols-3 gap-2 text-[11px] font-mono text-slate-400">
            <div>STT Supported: <span className={sttSupported ? 'text-emerald-400' : 'text-rose-400'}>{String(sttSupported)}</span></div>
            <div>Auto-listen: <span className="text-white">{String(autoListenEnabled)}</span></div>
            <div>Auto-submit: <span className="text-white">{String(autoSubmitEnabled)}</span></div>
          </div>

          {lastApiError && (
            <div className="p-2.5 rounded-xl bg-rose-950/80 border border-rose-500/40 text-rose-300 font-mono text-[10px] space-y-1">
              <div className="font-bold text-rose-400 flex items-center gap-1">
                <AlertTriangle className="h-3.5 w-3.5" /> API Error Telemetry (Caught in Dev):
              </div>
              <p className="break-all whitespace-pre-wrap">{lastApiError}</p>
            </div>
          )}

          <div className="max-h-36 overflow-y-auto space-y-1.5 text-[11px] font-mono bg-slate-950 p-3 rounded-xl border border-slate-800">
            {transcript.length === 0 ? (
              <span className="text-slate-500">No transcript entries recorded yet.</span>
            ) : (
              transcript.map((t, idx) => (
                <div key={idx} className={t.role === 'ai' ? 'text-blue-300' : 'text-emerald-300'}>
                  <strong>[{t.timestamp}] {t.role.toUpperCase()}:</strong> {t.text}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

