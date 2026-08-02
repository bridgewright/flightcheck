// Archive skeleton: a heading and a handful of table-row bars in the wide
// column the real page uses, so the swap to content doesn't jump.
export default function Loading() {
  return (
    <main
      aria-busy="true"
      className="mx-auto flex w-full max-w-5xl animate-pulse flex-col gap-4 px-6 pt-10 pb-12"
    >
      <span className="sr-only">Loading your sessions</span>
      <div aria-hidden="true" className="h-7 w-40 rounded bg-neutral-200 dark:bg-neutral-800" />
      <div aria-hidden="true" className="h-4 w-64 rounded bg-neutral-200 dark:bg-neutral-800" />
      <div aria-hidden="true" className="mt-4 flex flex-col gap-3">
        <div className="h-9 w-full rounded bg-neutral-200 dark:bg-neutral-800" />
        <div className="h-9 w-full rounded bg-neutral-200 dark:bg-neutral-800" />
        <div className="h-9 w-full rounded bg-neutral-200 dark:bg-neutral-800" />
        <div className="h-9 w-full rounded bg-neutral-200 dark:bg-neutral-800" />
      </div>
    </main>
  );
}
