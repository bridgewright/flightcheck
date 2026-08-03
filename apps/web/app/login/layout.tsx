import type { Metadata } from "next";

import { privateMetadata } from "../site";

// A metadata-only layout. The login page is a client component, and client
// components cannot export metadata — but the page still needs a resolvable
// base URL, because it inherits the root OG image and without one Next
// resolves that image against localhost. A sign-in link pasted into a chat
// would then unfurl with a broken picture.
//
// noindex for the ordinary reason: nothing in a search result should point at
// a sign-in form.

export const metadata: Metadata = privateMetadata("Sign in: flightcheck");

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
