import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const { history = [], userSpeech = "", role = "Software Engineer", round = "Technical Screening" } = await req.json();

    const systemPrompt = `You are a Principal Technical Interviewer at InternAdda assessing a candidate for ${role} (${round}).
Strict Rules:
1. Acknowledge what the candidate just said in one crisp sentence.
2. Ask exactly ONE progressive technical follow-up question.
3. NEVER repeat questions asked earlier in this conversation.
4. Keep entire output under 45 words so it sounds natural when spoken aloud.
5. Plain conversational English only. Do NOT use markdown, asterisks, bullet points, or emojis.`;

    const geminiKey = process.env.GEMINI_API_KEY?.trim();

    if (geminiKey) {
      try {
        const contents = [
          {
            role: "user",
            parts: [{ text: `System Context: ${systemPrompt}\n\nCandidate has joined.` }],
          },
          ...history.slice(-6).map((m: { role: string; text: string }) => ({
            role: m.role === "assistant" ? "model" : "user",
            parts: [{ text: m.text }],
          })),
          {
            role: "user",
            parts: [{ text: userSpeech || "Hello, I am ready." }],
          },
        ];

        // Handles both AQ. (new Studio keys) and AIzaSy (legacy keys)
        const isAqKey = geminiKey.startsWith("AQ.");
        const endpointUrl = isAqKey
          ? "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent"
          : `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`;

        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          "x-goog-api-key": geminiKey, // Standard header for Google Studio keys
        };

        if (isAqKey) {
          // Send key directly in Authorization header
          headers["Authorization"] = `Bearer ${geminiKey}`;
        }

        const res = await fetch(endpointUrl, {
          method: "POST",
          headers,
          body: JSON.stringify({
            contents,
            generationConfig: {
              temperature: 0.7,
              maxOutputTokens: 120,
            },
          }),
        });

        const data = await res.json();

        // If Authorization header fails with AQ key, fallback to direct x-goog-api-key without Bearer
        if (data?.error && isAqKey) {
          const retryRes = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-goog-api-key": geminiKey,
              },
              body: JSON.stringify({
                contents,
                generationConfig: {
                  temperature: 0.7,
                  maxOutputTokens: 120,
                },
              }),
            }
          );
          const retryData = await retryRes.json();
          if (retryData?.candidates?.[0]?.content?.parts?.[0]?.text) {
            const aiText = retryData.candidates[0].content.parts[0].text.replace(/[*_#]/g, "").trim();
            return NextResponse.json({ text: aiText });
          }
        }

        if (data?.candidates?.[0]?.content?.parts?.[0]?.text) {
          const aiText = data.candidates[0].content.parts[0].text.replace(/[*_#]/g, "").trim();
          return NextResponse.json({ text: aiText });
        } else if (data?.error) {
          console.error("Gemini API direct error:", data.error);
        }
      } catch (geminiError) {
        console.error("Gemini invocation error:", geminiError);
      }
    }

    // Dynamic emergency fallback to guarantee the interview never hangs
    const questionPool = [
      "That is a solid foundation. Walk me through how you optimize database query latencies when read traffic spikes.",
      "Understood. How do you handle cache invalidation and distributed session state in your production services?",
      "Good point. If a critical downstream third-party service fails, what resilience pattern would you use?",
      "Makes sense. Can you explain your strategy for CI/CD automated test suites to prevent regression bugs?",
    ];
    const nextQuestion = questionPool[history.length % questionPool.length];

    return NextResponse.json({ text: nextQuestion });
  } catch (error: any) {
    console.error("Fatal Route Error:", error);
    return NextResponse.json(
      { text: "Could you walk me through your experience building scalable REST and GraphQL APIs?" },
      { status: 200 }
    );
  }
}
