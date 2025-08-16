// api/transcribe.js
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Use POST" });
    return;
  }
  try {
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    const AUTH_SECRET = process.env.AUTH_SECRET;
    if (!OPENAI_API_KEY) {
      res.status(500).json({ ok: false, error: "Missing OPENAI_API_KEY" });
      return;
    }
    if (req.headers.authorization !== `Bearer ${AUTH_SECRET}`) {
      res.status(401).json({ ok: false, error: "unauthorized" });
      return;
    }

    // JSON body を安全側で取得
    let body = req.body;
    if (!body || typeof body === "string") {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      try { body = JSON.parse(Buffer.concat(chunks).toString()); } catch {}
    }
    const { audio_base64, filename = "memo.m4a", do_summary = true } = body || {};
    if (!audio_base64) {
      res.status(400).json({ ok: false, error: "no audio" });
      return;
    }

    // OpenAI へ転送（音声→文字）
    const buf = Buffer.from(audio_base64, "base64");
    const form = new FormData();
    form.append("file", new Blob([buf]), filename);
    form.append("model", "gpt-4o-transcribe");
    form.append("language", "ja");

    const sttResp = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: form
    });
    const stt = await sttResp.json();
    if (!stt?.text) throw new Error(JSON.stringify(stt));

    // （オプション）タイトル・要約
    let title = "", summary = "";
    if (do_summary) {
      const sys = "あなたは日本語アシスタントです。以下の文字起こしから30字以内のタイトルと3点の箇条書き要約をJSONで返す。";
      const user = `文字起こし:\n${stt.text}\n\n出力JSON: {"title":"...", "summary":"- ...\\n- ...\\n- ..."}`;
      const chatResp = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [{ role: "system", content: sys }, { role: "user", content: user }],
          temperature: 0.2
        })
      });
      const chat = await chatResp.json();
      try {
        const j = JSON.parse(chat.choices?.[0]?.message?.content || "{}");
        title = j.title || ""; summary = j.summary || "";
      } catch {}
    }

    res.status(200).json({ ok: true, text: stt.text, title, summary });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
}
