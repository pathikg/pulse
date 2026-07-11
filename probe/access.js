// GATE probe 1: does this key have Antigravity access? + learn the stream event shapes.
import { GoogleGenAI } from "@google/genai";
try { process.loadEnvFile(); } catch {}

const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });

console.log("→ creating Antigravity interaction (remote sandbox)…\n");
try {
  const stream = await ai.interactions.create({
    agent: "antigravity-preview-05-2026",
    input: "Run a shell command that prints 'hello from the sandbox' and today's date.",
    environment: "remote",
    stream: true,
  });

  let n = 0;
  for await (const event of stream) {
    n++;
    // Dump raw shapes so we learn event_type / delta.type for the real UI.
    console.log(JSON.stringify(event));
    if (n > 200) { console.log("…(truncated)"); break; }
  }
  console.log(`\n✅ ACCESS OK — streamed ${n} events. Antigravity is available on this key.`);
} catch (err) {
  console.error("\n❌ ACCESS FAILED:", err?.status || "", err?.message || err);
  console.error("If this is 403/permission → the key lacks Antigravity access. Fill Google's credit form / ask a rep.");
  process.exit(1);
}
