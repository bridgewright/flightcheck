import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2);

function option(name, fallback) {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1];
}

const rawTag = option("--tag", "untagged");
if (!rawTag || !/^[A-Za-z0-9._-]+$/.test(rawTag)) {
  throw new Error("--tag may contain only letters, numbers, dots, underscores, and hyphens");
}

const runPath = path.resolve(
  process.cwd(),
  option(
    "--input",
    "../../evals/out/morgan_naturalness/evalite-run.json",
  ),
);
const reportDirectory = path.resolve(
  process.cwd(),
  option("--out-dir", "../../evals/reports"),
);

const exportedRun = JSON.parse(await readFile(runPath, "utf8"));
const evals = exportedRun.suites?.flatMap((suite) => suite.evals ?? []) ?? [];
if (evals.length === 0) {
  throw new Error(`No eval results found in ${runPath}`);
}

const rows = evals.map((result) => {
  const input = result.input ?? {};
  const scores = Object.fromEntries(
    (result.scores ?? []).map((score) => [score.name, score.metadata ?? {}]),
  );
  return {
    caseId: String(input.case_id ?? "unknown"),
    source: String(input.source ?? "unknown"),
    scores,
  };
});
const axisNames = [...new Set(rows.flatMap((row) => Object.keys(row.scores)))];

function escapeCell(value) {
  return String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
}

function renderTable(group) {
  if (group.length === 0) return "_None._\n";
  const headings = axisNames.map((axis) => {
    const metadata = group.find((row) => row.scores[axis])?.scores[axis];
    return `${axis}${metadata?.status === "placeholder" ? "*" : ""}`;
  });
  const header = ["Case", "Source", ...headings];
  const lines = [
    `| ${header.map(escapeCell).join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
  ];
  for (const row of group) {
    const values = axisNames.map((axis) => row.scores[axis]?.actual ?? "missing");
    lines.push(
      `| ${[row.caseId, row.source, ...values].map(escapeCell).join(" | ")} |`,
    );
  }
  return `${lines.join("\n")}\n`;
}

const referenceRows = rows.filter((row) => row.source === "reference_avm");
const morganRows = rows.filter((row) => row.source !== "reference_avm");
const date = new Date().toISOString().slice(0, 10);
const outputPath = path.join(
  reportDirectory,
  `${date}-morgan-naturalness-${rawTag}.md`,
);
const markdown = [
  "# Morgan naturalness report",
  "",
  "> Report-only suite: not part of the release gate.",
  "",
  `Lever tag: \`${rawTag}\``,
  "",
  "Axes marked `*` use placeholder bands. Cells contain actual measured numbers.",
  "",
  "## Morgan cases",
  "",
  renderTable(morganRows).trimEnd(),
  "",
  "## Reference cases",
  "",
  renderTable(referenceRows).trimEnd(),
  "",
].join("\n");

await mkdir(reportDirectory, { recursive: true });
await writeFile(outputPath, markdown, "utf8");
console.log(`Report written to: ${outputPath}`);
