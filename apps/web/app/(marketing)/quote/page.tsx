import { redirect } from "next/navigation";

export default async function QuotePage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string }>;
}) {
  const params = await searchParams;
  const c = params?.c;
  // Client links (?c=token) open the simplified client experience.
  // The generic public flow continues to use the full step-by-step wizard.
  redirect(c ? `/quote/client?c=${encodeURIComponent(c)}` : "/quote/step1");
}
