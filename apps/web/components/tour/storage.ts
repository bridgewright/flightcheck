const TOUR_DONE_KEY = "fc-tour-done";

export function shouldShowTour(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(TOUR_DONE_KEY) === null;
  } catch {
    return false;
  }
}

export function markTourDone(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(TOUR_DONE_KEY, "1");
  } catch {
    // A blocked storage surface must not make Skip or Escape stop working.
  }
}
