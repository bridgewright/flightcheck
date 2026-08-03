// Session-detail skeleton (F-43): the report anatomy in grey — context line,
// verdict block, dimension cards, delivery metrics, transcript. The archive
// skeleton one segment up draws a table of rows, which is the wrong shape
// here and made the swap to content jump.
//
// Same pulse treatment and same reading column as app/loading.tsx and
// progress/loading.tsx, so the three read as one system.
export default function Loading() {
  return (
    <main
      aria-busy="true"
      className="mx-auto flex w-full max-w-2xl animate-pulse flex-col gap-10 px-6 pt-10 pb-12"
    >
      <span className="sr-only">Loading this session</span>
      <header className="flex flex-col gap-4">
        {/* Context line: role · session n of N · date */}
        <div aria-hidden="true" className="h-3 w-64 rounded bg-neutral-200 dark:bg-neutral-800" />
        {/* The verdict block — the tallest thing on the page, so the swap
            does not shove everything below it. */}
        <div aria-hidden="true" className="h-32 w-full rounded-lg bg-neutral-200 dark:bg-neutral-800" />
      </header>
      {/* Dimension cards */}
      <div aria-hidden="true" className="flex flex-col gap-3">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="h-20 w-full rounded-md bg-neutral-200 dark:bg-neutral-800" />
        ))}
      </div>
      {/* Delivery metrics, then the transcript */}
      <div aria-hidden="true" className="h-24 w-full rounded-md bg-neutral-200 dark:bg-neutral-800" />
      <div aria-hidden="true" className="h-56 w-full rounded-md bg-neutral-200 dark:bg-neutral-800" />
    </main>
  );
}
