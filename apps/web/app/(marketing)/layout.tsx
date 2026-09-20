import ClientLayout from "@/components/marketing/ClientLayout";

/** Marketing site frame: the redesign's chatbot and page behaviour, scoped away from the portal. */
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="marketing">
      <ClientLayout>{children}</ClientLayout>
    </div>
  );
}
