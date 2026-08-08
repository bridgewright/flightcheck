import { MAIN_READING, PAGE_HEADING } from "@/lib/ui";

export default function Loading() { return <main className={MAIN_READING}><h1 className={PAGE_HEADING}>Study</h1><div className="mt-6 h-24 animate-pulse rounded-surface bg-paper-sunk" /></main>; }
