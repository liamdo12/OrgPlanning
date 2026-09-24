"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { Toast, ToastRegion } from "@occasion/ui";

/**
 * Where a moderation decision's confirmation is announced.
 *
 * It lives above the queue rather than inside a card because deciding a report
 * takes that card out of the queue: a message rendered inside it is unmounted
 * by the very refresh that follows the decision, so the administrator acts and
 * is told nothing. Everywhere else in the admin screens the control survives
 * its own success and keeps its toast; this is the one place it does not.
 */
const Announce = createContext<((message: string) => void) | null>(null);

export function useDecisionOutcome(): (message: string) => void {
  const announce = useContext(Announce);
  if (!announce) {
    throw new Error("A moderation decision was made outside the queue's outcome region.");
  }
  return announce;
}

export function DecisionOutcomeRegion({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);

  return (
    <Announce.Provider value={setMessage}>
      {children}
      {message ? (
        <ToastRegion>
          <Toast tone="success" onDismiss={() => setMessage(null)}>
            {message}
          </Toast>
        </ToastRegion>
      ) : null}
    </Announce.Provider>
  );
}
