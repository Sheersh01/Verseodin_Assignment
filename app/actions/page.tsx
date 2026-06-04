import type { Metadata } from "next";
import ActionCentre from "./ActionCentre";

export const metadata: Metadata = {
  title: "Actions — Verseodin",
  description: "Prioritized recommendations to improve AI visibility, performance, and coverage.",
};

export default function ActionsPage() {
  return <ActionCentre />;
}

