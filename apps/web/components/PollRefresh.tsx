"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import {
  INITIAL_POLL_STATE,
  POLL_REARM_EVENTS,
  afterPoll,
  pollDelayMs,
  rearmedPollState,
} from "@/lib/poll-backoff";

// Re-fetches the current server component while a wait state ("compiling",
// "scoring") resolves, so status flips appear without a manual reload.
//
// Thin by construction: every timing decision lives in lib/poll-backoff.ts
// and is unit-tested there. This component only owns the three things that
// need the browser — the timer, the router, and page visibility.
//
// F-39: the interval backs off toward a ceiling and the run stops after a
// total budget, instead of asking every five seconds forever for an answer
// that may never change. Hidden tabs do not poll at all.
//
// Stopping is always reversible for a user who is actually there: a tab
// coming back to the foreground starts a fresh run, and so does any sign of
// a person in a tab that never left it (POLL_REARM_EVENTS). Both matter —
// a foreground tab stays "visible" for as long as the laptop is open, so
// visibility alone cannot tell a reader waiting on a slow score from a page
// abandoned two days ago, and this component renders nothing that could
// tell the reader to reload.
export default function PollRefresh({ intervalMs }: { intervalMs: number }) {
  const router = useRouter();
  const [state, setState] = useState(INITIAL_POLL_STATE);
  // Lazy initializer rather than a setState inside the mount effect: this
  // component renders null, so reading the live visibility during the first
  // client render cannot mismatch anything the server produced.
  const [visible, setVisible] = useState(
    () => typeof document === "undefined" || document.visibilityState === "visible",
  );

  useEffect(() => {
    const onVisibilityChange = () => {
      const isVisible = document.visibilityState === "visible";
      setVisible(isVisible);
      // Someone is reading the page again: fresh run, fresh budget. This is
      // what keeps the circuit breaker from being a permanent give-up.
      if (isVisible) setState(rearmedPollState());
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);

  // The way back from a tripped breaker in a tab that never went away.
  // Armed only while stopped, so an active run costs no listeners; a tab
  // nobody touches produces none of these events and stays stopped, which
  // is the traffic the breaker exists to stop sending.
  useEffect(() => {
    if (!state.tripped || !visible) return;
    const rearm = () => setState(rearmedPollState());
    for (const type of POLL_REARM_EVENTS) {
      window.addEventListener(type, rearm, { passive: true, once: true });
    }
    return () => {
      for (const type of POLL_REARM_EVENTS) {
        window.removeEventListener(type, rearm);
      }
    };
  }, [state.tripped, visible]);

  useEffect(() => {
    if (!visible) return;
    const limits = { baseMs: intervalMs };
    const delayMs = pollDelayMs(state, limits);
    if (delayMs === null) return; // breaker tripped — stop scheduling
    const id = setTimeout(() => {
      router.refresh();
      setState((current) => afterPoll(current, limits));
    }, delayMs);
    return () => clearTimeout(id);
  }, [router, intervalMs, state, visible]);

  return null;
}
