import type { Metadata } from "next";
import TrafficDashboard from "./TrafficDashboard";

export const metadata: Metadata = {
  title: "AI Traffic — Verseodin",
  description: "See which AI crawlers visited your site, which pages they read, and at what volume over the last 90 days.",
};

export default function TrafficPage() {
  return (
    <main className="mx-auto max-w-screen-xl px-6 py-8">
      <TrafficDashboard />
    </main>
  );
}
