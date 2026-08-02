export interface Viewer {
  id: string;
  email: string | null;
}

/** Placeholder until the auth track merges. The controller rewires this
 * file to lib/supabase/server.getViewer() at integration — keep the
 * signature identical and never import lib/supabase here. */
export async function getViewer(): Promise<Viewer | null> {
  return null;
}
