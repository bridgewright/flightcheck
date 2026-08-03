import { SKELETON } from "@/lib/ui";

// App-level loading state: a plain pulse skeleton in the reading column most
// screens use. Deliberately shapeless — per-section loading files can draw
// truer skeletons later.
export default function Loading() {
  return (
    <main
      aria-busy="true"
      className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-6 pt-10 pb-12"
    >
      <span className="sr-only">Loading</span>
      <div aria-hidden="true" className={`${SKELETON} h-7 w-2/5`} />
      <div aria-hidden="true" className={`${SKELETON} h-4 w-3/5`} />
      <div aria-hidden="true" className={`${SKELETON} mt-4 h-40 w-full`} />
      <div aria-hidden="true" className={`${SKELETON} h-24 w-full`} />
    </main>
  );
}
