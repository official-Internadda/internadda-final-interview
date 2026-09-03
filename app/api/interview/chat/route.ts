import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const { history, userSpeech, role, round } = await req.json();

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "GEMINI_API_KEY is not set" }, { status: 500 });
    }

    const systemInstruction = `You are an elite Senior Technical Hiring Manager at InternAdda conducting a strict, realistic mock interview for a "${role || 'Full Stack Engineer'}" position (Round: ${round || 'Technical Screening'}).
Rules:
1. NEVER repeat a question you already asked in the history.
2. Evaluate what the user just said in 1 concise sentence (critique or acknowledge), then immediately follow up with the next challenging, natural interview question.
3. Keep your spoken output under 60 words so the conversation stays fast, lively, and realistic.
4. Do not include markdown asterisks, bullet points, or emojis, because your response will be read directly by text-to-speech.
5. If the user gives a vague or incomplete answer, politely probe deeper. If they answered well, advance to the next technical topic.`;

    // Map existing history to Gemini format
    const contents = [
      {
        role: "user",
        parts: [{ text: `System Context: ${systemInstruction}\n\nStart the interview or continue.` }]
      },
      ...history.map((msg: { role: string; text: string }) => ({
        role: msg.role === "assistant" ? "model" : "user",
        parts: [{ text: msg.text }]
      })),
      {
        role: "user",
        parts: [{ text: userSpeech }]
      }
    ];

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents,
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 150,
          }
        }),
      }
    );

    const data = await response.json();
    if (data.error) {
      throw new Error(data.error.message || "Gemini API error");
    }

    const aiText = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "Could you please elaborate on that?";

    return NextResponse.json({ text: aiText });
  } catch (error: any) {
    console.error("Interview API Error:", error);
    return NextResponse.json({ error: error.message || "Something went wrong" }, { status: 500 });
  }
}
