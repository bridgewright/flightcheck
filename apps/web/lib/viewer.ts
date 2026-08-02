// The identity seam between the screens and the auth foundation. Screens
// import ONLY this module for "who is signed in", so the two tracks could
// build in parallel; this file is the single point where they meet.
import { getViewer as supabaseGetViewer } from "./supabase/server";

export interface Viewer {
  id: string;
  email: string | null;
}

export async function getViewer(): Promise<Viewer | null> {
  return supabaseGetViewer();
}
