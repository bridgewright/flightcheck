// App-level loading state: a plain pulse skeleton in the reading column most
// screens use. Deliberately shapeless — per-section loading files can draw
// truer skeletons later.
export default function Loading() {
  return (
    <main
      aria-busy="true"
      className="mx-auto flex w-full max-w-2xl animate-pulse flex-col gap-4 px-6 pt-10 pb-12"
    >
      <span className="sr-only">Loading</span>
      <div aria-hidden="true" className="h-7 w-2/5 rounded bg-neutral-200 dark:bg-neutral-800" />
      <div aria-hidden="true" className="h-4 w-3/5 rounded bg-neutral-200 dark:bg-neutral-800" />
      <div aria-hidden="true" className="mt-4 h-40 w-full rounded-md bg-neutral-200 dark:bg-neutral-800" />
      <div aria-hidden="true" className="h-24 w-full rounded-md bg-neutral-200 dark:bg-neutral-800" />
    </main>
  );
}
