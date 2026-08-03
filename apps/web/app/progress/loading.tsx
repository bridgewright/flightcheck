import {MAIN_READING, SKELETON} from "@/lib/ui";

// Progress-shaped skeleton: heading, the trajectory strip's row of columns,
// then two table blocks. Same pulse treatment as the app-level loading state.
export default function Loading() {
  return (
    <main
      aria-busy="true"
      className={`${MAIN_READING} flex flex-col`}
    >
      <span className="sr-only">Loading your progress</span>
      <div aria-hidden="true" className={`${SKELETON} mx-auto h-7 w-2/5`} />
      <div aria-hidden="true" className={`${SKELETON} mx-auto mt-2 mb-8 h-4 w-3/5`} />
      {/* overflow-x-auto, as ProgressTrajectory has. The skeleton copied that
          component's six min-w-[84px] cells and not its scroller, so on a phone
          it needed 539px inside a 348px column and pushed the whole page
          sideways. The literal is a pixel value, so no root size fixes it. */}
      <div aria-hidden="true" className="flex gap-2 overflow-x-auto">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className={`${SKELETON} h-20 min-w-[84px] flex-1`} />
        ))}
      </div>
      <div aria-hidden="true" className={`${SKELETON} mt-8 h-48 w-full`} />
      <div aria-hidden="true" className={`${SKELETON} mt-8 h-32 w-full`} />
    </main>
  );
}
