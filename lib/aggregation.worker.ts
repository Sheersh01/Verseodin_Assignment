import type { AiVisit } from "@/lib/types";
import { aggregateVisits } from "./aggregateVisits";

self.onmessage = (e: MessageEvent<AiVisit[]>) => {
  const result = aggregateVisits(e.data);
  self.postMessage(result);
};
