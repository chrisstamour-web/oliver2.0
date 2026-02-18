// lib/embeddings/openai.ts

type OpenAIEmbeddingResponse = {
  data: Array<{ embedding: number[] }>;
};

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export async function embedText(text: string): Promise<number[]> {
  const apiKey = requireEnv("OPENAI_API_KEY");
  const model = process.env.EMBEDDING_MODEL || "text-embedding-3-small";

  const input = String(text ?? "").slice(0, 30_000); // avoid accidental huge payloads

  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input,
    }),
  });

  if (!res.ok) {
    const msg = await res.text();
    throw new Error(`OpenAI embeddings failed (${res.status}): ${msg}`);
  }

  const json = (await res.json()) as OpenAIEmbeddingResponse;
  const emb = json?.data?.[0]?.embedding;

  if (!Array.isArray(emb) || emb.length === 0) {
    throw new Error("OpenAI embeddings returned empty embedding");
  }

  return emb;
}
