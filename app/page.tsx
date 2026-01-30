import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getOrCreateThread } from "./actions/getOrCreateThread";
import ChatComposer from "@/app/components/ChatComposer";


const BRAND = "#49257a";

export default async function Home() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();

  if (!data.user) redirect("/login");

  const threadId = await getOrCreateThread();

  const { data: messages } = await supabase
    .from("chat_messages")
    .select("id, role, content, created_at")
    .eq("thread_id", threadId)
    .order("created_at", { ascending: true });

  return (
    <main style={{ maxWidth: 820, margin: "40px auto", padding: 16 }}>
      <h1 style={{ fontWeight: 900, color: BRAND, marginBottom: 12 }}>
        Oliver 2.0
      </h1>

      <div
        style={{
          border: "1px solid #e7e7e7",
          borderRadius: 16,
          padding: 16,
          minHeight: 300,
          marginBottom: 12,
        }}
      >
        {messages?.length ? (
          messages.map((m) => (
            <div
              key={m.id}
              style={{
                marginBottom: 10,
                textAlign: m.role === "user" ? "right" : "left",
              }}
            >
              <div
                style={{
                  display: "inline-block",
                  background:
                    m.role === "user" ? BRAND : "#f3f3f3",
                  color: m.role === "user" ? "white" : "#111",
                  padding: "8px 12px",
                  borderRadius: 12,
                  maxWidth: "80%",
                }}
              >
                {m.content}
              </div>
            </div>
          ))
        ) : (
          <div style={{ opacity: 0.6 }}>
            Start the conversation…
          </div>
        )}
      </div>

    <ChatComposer threadId={threadId} />

    </main>
  );
}
