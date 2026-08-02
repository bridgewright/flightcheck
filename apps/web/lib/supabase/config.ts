// Public Supabase connection values.
//
// Both values are DESIGNED to ship in client bundles: the URL identifies the
// project and the publishable key grants only what RLS allows (every table
// denies anonymous access; the browser never queries the database directly —
// data flows through server routes). Hardcoded fallbacks keep deploys
// independent of per-platform env configuration; environment variables still
// override when present. The service-role key never appears here.
export const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ??
  "https://rvkecrwdohriruuulnzm.supabase.co";

export const SUPABASE_PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  "sb_publishable_L6uH-iaC24u5vhFLiiPCUA_KHwO5sYm";
