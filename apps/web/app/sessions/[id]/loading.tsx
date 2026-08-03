import {MAIN_READING, SKELETON} from "@/lib/ui";

// Session-detail skeleton (F-43): the report anatomy in tokenized blocks — context line,
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
      className={`${MAIN_READING} flex flex-col gap-10`}
    >
      <span className="sr-only">Loading this session</span>
      <header className="flex flex-col gap-4">
        {/* Context line: role · session n of N · date */}
        <div aria-hidden="true" className={`${SKELETON} h-3 w-64`} />
        {/* The verdict block — the tallest thing on the page, so the swap
            does not shove everything below it. */}
        <div aria-hidden="true" className={`${SKELETON} h-32 w-full`} />
      </header>
      {/* Dimension cards */}
      <div aria-hidden="true" className="flex flex-col gap-3">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className={`${SKELETON} h-20 w-full`} />
        ))}
      </div>
      {/* Delivery metrics, then the transcript */}
      <div aria-hidden="true" className={`${SKELETON} h-24 w-full`} />
      <div aria-hidden="true" className={`${SKELETON} h-56 w-full`} />
    </main>
  );
}
