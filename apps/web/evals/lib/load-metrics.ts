import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

export interface MorganMetricsCase {
  case_id: string;
  source: string;
  audio_sha256: string;
  duration_s: number;
  segments_path: string;
  // A null metric value is honest "could not measure" (e.g. f0 variance on
  // unvoiced audio) — distinct from an ABSENT field, which is schema drift.
  metrics: Record<string, number | null | Record<string, number | null>>;
}

const outputDirectory = path.resolve(
  process.cwd(),
  "../../evals/out/morgan_naturalness",
);
const syntheticFixture = path.resolve(
  process.cwd(),
  "evals/fixtures/synthetic.metrics.json",
);

async function readMetrics(filePath: string): Promise<MorganMetricsCase> {
  return JSON.parse(await readFile(filePath, "utf8")) as MorganMetricsCase;
}

export async function loadMetricsCases(): Promise<MorganMetricsCase[]> {
  let filenames: string[] = [];
  try {
    filenames = (await readdir(outputDirectory))
      .filter((filename) => filename.endsWith(".metrics.json"))
      .sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  if (filenames.length === 0) {
    const synthetic = await readMetrics(syntheticFixture);
    return [{ ...synthetic, case_id: "synthetic", source: "synthetic" }];
  }

  return Promise.all(
    filenames.map((filename) => readMetrics(path.join(outputDirectory, filename))),
  );
}
