"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import LinkedInPdfHelp from "@/components/LinkedInPdfHelp";
import type { CreatePackageBody } from "@/lib/types";
import { ERROR_TEXT, FIELD, FINE_PRINT, LINK, MAIN_READING, PAGE_HEADING, PRIMARY_BUTTON, SECTION_HEADING } from "@/lib/ui";

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export default function NewPackagePage() {
  const router = useRouter();
  const [jdUrl, setJdUrl] = useState("");
  const [jdText, setJdText] = useState("");
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [resumeText, setResumeText] = useState("");
  const [linkedinFile, setLinkedinFile] = useState<File | null>(null);
  const [linkedinText, setLinkedinText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!jdUrl.trim() && !jdText.trim()) {
      setError("Provide the job description: paste its text or its URL.");
      return;
    }
    setSubmitting(true);
    try {
      const body: CreatePackageBody = {};
      if (jdUrl.trim()) body.jd_url = jdUrl.trim();
      if (jdText.trim()) body.jd_text = jdText.trim();
      if (resumeFile) body.resume_pdf_b64 = await fileToBase64(resumeFile);
      if (resumeText.trim()) body.resume_text = resumeText.trim();
      if (linkedinFile) body.linkedin_pdf_b64 = await fileToBase64(linkedinFile);
      if (linkedinText.trim()) body.linkedin_text = linkedinText.trim();
      const response = await fetch("/api/packages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await response.json()) as {
        package_id?: string;
        access_token?: string;
        error?: string;
      };
      if (!response.ok || !data.package_id) {
        throw new Error(data.error ?? `request failed (${response.status})`);
      }
      // Through /switch: it verifies ownership and pins this package as the
      // active one (fc_pkg cookie), so /rubric — and every section screen
      // after it — is already "about" the package that was just created.
      // reveal=1 turns on the one-time "This is the bar." framing.
      router.push(
        `/switch?pkg=${encodeURIComponent(data.package_id)}` +
          `&next=${encodeURIComponent("/rubric?reveal=1")}`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "request failed");
      setSubmitting(false);
    }
  }

  return (
    <main className={`${MAIN_READING} flex min-h-dvh flex-col gap-8`}>
      <h1 className={PAGE_HEADING}>Set up your interview package</h1>
      {/* A first sign-in lands here with a JD in hand or not at all; the
          product must never read as "paste a JD or leave" (user direction
          2026-08-05). */}
      <p className={FINE_PRINT}>
        No JD in hand yet?{" "}
        <Link href="/home" className={LINK}>
          Look around your home first.
        </Link>
      </p>
      <form onSubmit={onSubmit} className="flex flex-col gap-8">
        <fieldset className="flex flex-col gap-3">
          <legend className={`${SECTION_HEADING} mb-2`}>Job description (required)</legend>
          <label className="flex flex-col gap-1 text-fine">
            JD URL
            <input
              type="url"
              value={jdUrl}
              onChange={(e) => setJdUrl(e.target.value)}
              placeholder="https://careers.example.com/jobs/1234"
              className={FIELD}
            />
          </label>
          <label className="flex flex-col gap-1 text-fine">
            &hellip;or paste the JD text
            <textarea
              value={jdText}
              onChange={(e) => setJdText(e.target.value)}
              rows={8}
              placeholder="Paste the full job description here."
              className={FIELD}
            />
          </label>
        </fieldset>
        <fieldset className="flex flex-col gap-3">
          <legend className={`${SECTION_HEADING} mb-2`}>Resume (optional)</legend>
          <label className="flex flex-col gap-1 text-fine">
            Resume PDF
            <input
              type="file"
              accept="application/pdf"
              onChange={(e) => setResumeFile(e.target.files?.[0] ?? null)}
            />
          </label>
          <label className="flex flex-col gap-1 text-fine">
            &hellip;or paste your resume as text
            <textarea
              value={resumeText}
              onChange={(e) => setResumeText(e.target.value)}
              rows={4}
              className={FIELD}
            />
          </label>
        </fieldset>
        <fieldset className="flex flex-col gap-3">
          <legend className={`${SECTION_HEADING} mb-2`}>LinkedIn profile (optional)</legend>
          <p className={FINE_PRINT}>
            Export it from LinkedIn: open your profile, then <em>More &gt; Save to PDF</em>.
            Upload that PDF here.
          </p>
          <div className="flex flex-col gap-1 text-fine">
            {/* The row is the bubble's anchor below sm (full width, over the
              field); from sm up the details element inside the helper takes
              over and the bubble hangs off the trigger itself. */}
            <span className="relative flex items-center gap-1.5">
              <label htmlFor="linkedin-profile-pdf">LinkedIn profile PDF</label>
              <LinkedInPdfHelp inputId="linkedin-profile-pdf" />
            </span>
            <input
              id="linkedin-profile-pdf"
              type="file"
              accept="application/pdf"
              onChange={(e) => setLinkedinFile(e.target.files?.[0] ?? null)}
            />
          </div>
          <label className="flex flex-col gap-1 text-fine">
            &hellip;or paste your profile as text
            <textarea
              value={linkedinText}
              onChange={(e) => setLinkedinText(e.target.value)}
              rows={4}
              className={FIELD}
            />
          </label>
        </fieldset>
        {error ? <p className={ERROR_TEXT}>{error}</p> : null}
        <button
          type="submit"
          disabled={submitting}
          className={`${PRIMARY_BUTTON} self-start`}
        >
          {submitting ? "Creating your package…" : "Compile my interview package"}
        </button>
      </form>
    </main>
  );
}
