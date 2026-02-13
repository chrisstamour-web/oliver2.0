// app/(auth)/login/page.tsx
import LoginClient from "./LoginClient";

export default async function LoginPage({
  searchParams,
}: {
  searchParams?: Promise<{ next?: string }>;
}) {
  const sp = (await searchParams) ?? {};
  const next = typeof sp.next === "string" && sp.next.trim() ? sp.next : "/";

  return <LoginClient next={next} />;
}
