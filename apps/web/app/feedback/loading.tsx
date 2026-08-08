import { SKELETON } from "@/lib/ui";

export default function Loading() {
  return <div className="mx-auto w-full max-w-reading px-6 py-12"><div className={`${SKELETON} h-9 w-40`} /><div className={`${SKELETON} mt-8 h-64 w-full`} /></div>;
}
