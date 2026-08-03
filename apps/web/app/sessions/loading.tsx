import { SKELETON } from "@/lib/ui";

// Archive skeleton: a heading and a handful of table-row bars in the wide
// column the real page uses, so the swap to content doesn't jump.
export default function Loading() {
  return (
    <main
      aria-busy="true"
      className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-6 pt-10 pb-12"
    >
      <span className="sr-only">Loading your sessions</span>
      <div aria-hidden="true" className={`${SKELETON} h-7 w-40`} />
      <div aria-hidden="true" className={`${SKELETON} h-4 w-64`} />
      <div aria-hidden="true" className="mt-4 flex flex-col gap-3">
        <div className={`${SKELETON} h-9 w-full`} />
        <div className={`${SKELETON} h-9 w-full`} />
        <div className={`${SKELETON} h-9 w-full`} />
        <div className={`${SKELETON} h-9 w-full`} />
      </div>
    </main>
  );
}
