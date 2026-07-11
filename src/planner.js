import { Type } from "@google/genai";

// The planner is the STAR: given a ticket, it invents the right specialist crew for THAT ticket
// (never generic "Backend Agent" roles). Fast, reliable — a plain Gemini 3.5 Flash JSON call.

const crewSchema = {
  type: Type.OBJECT,
  properties: {
    specialists: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING, description: "Specific title, e.g. 'OAuth Integrator'." },
          role: { type: Type.STRING, description: "One short phrase." },
          responsibilities: { type: Type.STRING, description: "One line of what they own." },
          why: { type: Type.STRING, description: "Why THIS ticket needs them." },
        },
        required: ["name", "role", "responsibilities"],
      },
    },
  },
  required: ["specialists"],
};

export async function runPlanner(ai, ticket) {
  const res = await ai.models.generateContent({
    model: "gemini-3.5-flash",
    contents:
      `Ticket: "${ticket}"\n\n` +
      `Invent the RIGHT crew of 3-4 specialist agents to resolve THIS specific ticket. ` +
      `Titles must be specific to the ticket (e.g. "OAuth Integrator", "Query Optimizer", "Index Analyzer") — ` +
      `NEVER generic roles like "Backend Agent" or "Frontend Agent". Order them by who leads.`,
    config: {
      responseMimeType: "application/json",
      responseSchema: crewSchema,
      systemInstruction: "You are the planner for an autonomous engineering platform. Return only the crew as JSON.",
    },
  });
  return JSON.parse(res.text);
}
