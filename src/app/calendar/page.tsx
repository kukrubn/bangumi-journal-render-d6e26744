import { CollectionPage } from "@/features/collection-page";
export const dynamic = "force-dynamic";
export const metadata = { title: "放送周表 · 番剧手账" };
export default function CalendarPage() {
  return <CollectionPage view="calendar" />;
}
