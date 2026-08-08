import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { sessionHeading } from "@/components/study-view";
import type { PackageBookmarks, StudyMaterials } from "@/lib/types";

const WHITE = "#ffffff";
const INK = "#171717";
const MUTED_INK = "#555555";
const QUOTE_INK = "#333333";
const RULE = "#aaaaaa";
const styles = StyleSheet.create({ page: { backgroundColor: WHITE, color: INK, fontFamily: "Helvetica", fontSize: 10, lineHeight: 1.45, padding: 42 }, title: { fontFamily: "Helvetica-Bold", fontSize: 20 }, context: { color: MUTED_INK, marginBottom: 16 }, section: { marginTop: 16 }, heading: { fontFamily: "Helvetica-Bold", fontSize: 12, marginBottom: 5 }, subheading: { fontFamily: "Helvetica-Bold", marginTop: 7 }, item: { marginBottom: 3 }, quote: { borderLeftColor: RULE, borderLeftWidth: 1, color: QUOTE_INK, marginTop: 4, paddingLeft: 8 }, footer: { borderTopColor: RULE, borderTopWidth: 1, color: MUTED_INK, marginTop: 20, paddingTop: 8 } });

export default function StudyPdf({ doc, bookmarks, meta }: { doc: StudyMaterials; bookmarks: PackageBookmarks | null; meta: { roleTitle: string | null; generatedAt: string } }) {
  return <Document title="flightcheck study guide"><Page size="A4" style={styles.page} wrap>
    <Text style={styles.title}>flightcheck study guide</Text><Text style={styles.context}>{meta.roleTitle ?? "Interview role"} | {meta.generatedAt}</Text>
    <View style={styles.section}><Text style={styles.heading}>Where you stand</Text>{doc.summary.core_problems.map((problem) => <View key={problem.title}><Text style={styles.subheading}>{problem.title}</Text><Text>{problem.description}</Text></View>)}<Text style={styles.subheading}>Improvement strategy</Text>{doc.summary.improvement_strategy.map((step, index) => <Text style={styles.item} key={step}>{index + 1}. {step}</Text>)}<Text style={styles.subheading}>Priority expressions</Text>{doc.summary.priority_expressions.map((item) => <Text style={styles.quote} key={item}>{item}</Text>)}</View>
    <View style={styles.section}><Text style={styles.heading}>Saved from your sessions</Text>{bookmarks?.sessions.map((session) => <View key={session.session_id}><Text style={styles.subheading}>{sessionHeading(session.session_index)}</Text>{session.items.map((item) => <View key={item.turn_index}><Text style={styles.quote}>{item.source_quote}</Text><Text>{item.suggestion}</Text><Text style={styles.context}>{item.why}</Text></View>)}</View>)}</View>
    <View style={styles.section}><Text style={styles.heading}>Answers to memorize</Text>{doc.jd_core_answers.map((answer) => <View key={answer.question}><Text style={styles.subheading}>{answer.question}</Text><Text>{answer.model_answer}</Text>{answer.based_on_quotes.map((quote) => <Text style={styles.quote} key={quote}>{quote}</Text>)}</View>)}</View>
    <Text style={styles.footer}>Generated text based on your session material.</Text>
  </Page></Document>;
}
