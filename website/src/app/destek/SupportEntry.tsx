"use client";

import { SupportPage } from "@/components/pages/SupportPage";

// Keep the support page subtree behind one explicit client boundary.
export default function SupportEntry() {
  return <SupportPage />;
}
