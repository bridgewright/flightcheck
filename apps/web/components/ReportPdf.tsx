import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";

import { emphasiseRationale } from "@/lib/rationale";
import { formatTimestamp, VERDICT_LABELS } from "@/lib/report-format";
import type { ReportExportMeta } from "@/lib/report-markdown";
import type { DimensionScore, SessionReport } from "@/lib/types";
import { MAX_SCORE, READY_OVERALL } from "@/lib/verdict";

// The export's own palette, and the one file allowed to hold literal colour
// (declared in tests/token-vocabulary.test.ts's EXEMPT, with the reason).
// Deliberately not the product's warm paper: a report that is printed or
// attached to an email is read on white.
const WHITE = "#ffffff";
const INK = "#171717";
const MUTED_INK = "#555555";
const QUOTE_INK = "#333333";
const RULE = "#aaaaaa";

const styles = StyleSheet.create({
  page: { backgroundColor: WHITE, color: INK, fontFamily: "Helvetica", fontSize: 10, lineHeight: 1.45, padding: 42 },
  title: { fontFamily: "Helvetica-Bold", fontSize: 20, marginBottom: 9 },
  context: { color: MUTED_INK, marginBottom: 20 },
  verdict: { fontFamily: "Helvetica-Bold", fontSize: 16, marginBottom: 4 },
  headline: { fontSize: 12, marginBottom: 4 },
  score: { borderBottomColor: RULE, borderBottomWidth: 1, paddingBottom: 12 },
  section: { marginTop: 16 },
  heading: { fontFamily: "Helvetica-Bold", fontSize: 12, marginBottom: 5 },
  subheading: { fontFamily: "Helvetica-Bold", marginTop: 7, marginBottom: 3 },
  item: { marginBottom: 3 },
  keySpan: { fontFamily: "Helvetica-Bold" },
  quote: { borderLeftColor: RULE, borderLeftWidth: 1, color: QUOTE_INK, marginTop: 4, paddingLeft: 8 },
  footer: { borderTopColor: RULE, borderTopWidth: 1, color: MUTED_INK, marginTop: 20, paddingTop: 8 },
  // Fixed, so it repeats. A report is printed and handed over, and loose
  // pages with no numbers on them are pages somebody reassembles wrong.
  pageNumber: { bottom: 20, color: MUTED_INK, fontSize: 8, left: 42, position: "absolute", right: 42, textAlign: "right" },
});

const list = (items: string[]) => items.length === 0
  ? <Text>None recorded.</Text>
  : items.map((item) => <Text key={item} style={styles.item}>• {item}</Text>);

// The judge's own span (F-48) is emphasised in place; the fallback stays the
// plain block it was before the field existed, so every stored report prints
// exactly as it always did.
function Rationale({ score }: { score: DimensionScore }) {
  const parts = emphasiseRationale(score.rationale, score.key_span);
  if (parts.source === "key_span") {
    return (
      <Text>{parts.before}<Text style={styles.keySpan}>{parts.span}</Text>{parts.after}</Text>
    );
  }
  return <Text>{score.rationale}</Text>;
}

export default function ReportPdf({ report, meta }: { report: SessionReport; meta: ReportExportMeta }) {
  const metrics = report.delivery_metrics;
  const nameFor = (key: string) => meta.dimensions.find((dimension) => dimension.key === key)?.name ?? key;
  return (
    <Document title={`flightcheck session ${meta.sessionNumber} report`}>
      <Page size="A4" style={styles.page} wrap>
        <Text style={styles.title}>flightcheck session report</Text>
        <Text style={styles.context}>Session {meta.sessionNumber} | {meta.sessionDate} | {meta.roleTitle}</Text>
        <Text style={styles.verdict}>{VERDICT_LABELS[report.verdict]}</Text>
        {report.headline ? <Text style={styles.headline}>{report.headline}</Text> : null}
        <Text style={styles.score}>Overall score: {report.overall_score.toFixed(1)} / {MAX_SCORE.toFixed(1)} | Ready bar: {READY_OVERALL.toFixed(1)}</Text>

        {report.dimension_scores.map((score) => {
          // Declared required, but reports stored before F-03 omit the keys
          // at runtime: read defensively, print the subheadings only when
          // they say something, exactly as the screen does.
          const strengths = score.strengths ?? [];
          const weaknesses = score.weaknesses ?? [];
          return (
            <View key={score.dimension_key} style={styles.section}>
              <Text style={styles.heading}>{nameFor(score.dimension_key)}: {score.score.toFixed(1)} / {MAX_SCORE.toFixed(1)}</Text>
              <Rationale score={score} />
              {strengths.length > 0 && <><Text style={styles.subheading}>What worked</Text>{list(strengths)}</>}
              {weaknesses.length > 0 && <><Text style={styles.subheading}>What held the score down</Text>{list(weaknesses)}</>}
              {score.evidence_quotes.map((quote) => <Text key={quote} style={styles.quote}>{quote}</Text>)}
            </View>
          );
        })}

        <View style={styles.section}>
          <Text style={styles.heading}>Delivery metrics</Text>
          <Text>Pace: {Math.round(metrics.wpm_overall)} WPM</Text>
          <Text>Fillers: {metrics.filler_count} total, {metrics.filler_rate_per_min.toFixed(1)} per minute</Text>
          <Text>Silences at least 1s: {metrics.silence_events.length}</Text>
          <Text>Pitch variance: {metrics.f0_variance === null ? "n/a" : metrics.f0_variance.toFixed(1)}</Text>
          <Text>Average response latency: {metrics.avg_response_latency_s === null ? "n/a" : `${metrics.avg_response_latency_s.toFixed(1)}s`}</Text>
          <Text>Pace timeline: {metrics.wpm_timeline.length === 0 ? "n/a" : metrics.wpm_timeline.map((wpm) => `${Math.round(wpm)} WPM`).join(", ")}</Text>
          {metrics.silence_events.map((event) => <Text key={`${event.start_s}-${event.duration_s}`}>Silence at {formatTimestamp(event.start_s)}: {event.duration_s.toFixed(1)}s</Text>)}
        </View>

        <View style={styles.section}>
          <Text style={styles.heading}>Delivery observations</Text>
          {report.delivery_observations.length === 0 ? <Text>None recorded.</Text> : report.delivery_observations.map((observation) => (
            <Text key={`${observation.at_s}-${observation.kind}`}>{formatTimestamp(observation.at_s)}: {observation.note}</Text>
          ))}
        </View>
        <View style={styles.section}><Text style={styles.heading}>Strengths</Text>{list(report.strengths)}</View>
        <View style={styles.section}><Text style={styles.heading}>Gaps</Text>{list(report.gaps)}</View>
        <View style={styles.section}><Text style={styles.heading}>Next drills</Text>{list(report.next_drills)}</View>
        <View style={styles.section}><Text style={styles.heading}>Limits</Text><Text>{report.limits_note}</Text></View>
        <Text style={styles.footer}>Generated by flightcheck on {meta.generatedDate}.</Text>
        <Text
          fixed
          render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`}
          style={styles.pageNumber}
        />
      </Page>
    </Document>
  );
}
