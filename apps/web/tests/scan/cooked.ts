import ts from "typescript";

export interface CookedString {
  value: string;
  line: number;
}

/**
 * What an unknown fragment contributes to a folded value: a space, never "".
 *
 * "" glues two literals into a token nobody wrote — `` `bg-red${suffix}-500` ``
 * would be reported as `bg-red-500` in a file that does not contain it — and a
 * private sentinel is the mirror mistake. This module shipped with `"\0"`, and
 * `"#" + "8b5cf" + shade` then walked the whole gate: the cooked value
 * `"#8b5cf\0"` fails the whole-value hex rule, and the per-line pass sees no
 * quoted hex either, because neither fragment is one. A space keeps the rules
 * that anchor on a whole value (`/^\s*#[0-9a-fA-F]{3,8}\s*$/`) reading that for
 * what it is. The corpus pins both directions.
 */
const UNKNOWN = " ";

export function cookedStrings(source: string, fileName?: string): CookedString[] {
  const name = fileName ?? "scan.tsx";
  const sourceFile = ts.createSourceFile(
    name,
    source,
    ts.ScriptTarget.Latest,
    true,
    // A .ts file parsed as TSX misreads a generic arrow (`<T>(v: T) => v`) as an
    // unclosed JSX element and recovers by dropping what follows, which would
    // leave this scan reading less than the file says while still passing.
    // Parse each file as what it is.
    name.endsWith(".ts") ? ts.ScriptKind.TS : ts.ScriptKind.TSX,
  );

  // A gate that cannot read its input has to say so. Parser error recovery
  // hands back a tree with fewer strings in it, and a scan over that tree is
  // green for the same reason an empty scan is.
  const errors =
    (sourceFile as unknown as { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics ??
    [];
  if (errors.length > 0) {
    const first = ts.flattenDiagnosticMessageText(errors[0].messageText, " ");
    throw new Error(`${name} did not parse, so the cooked scan cannot read it: ${first}`);
  }

  const out: CookedString[] = [];

  function fold(node: ts.Node): string | undefined {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      return node.text;
    }
    if (ts.isJsxText(node)) return node.text;
    if (ts.isParenthesizedExpression(node)) return fold(node.expression);
    if (ts.isTemplateExpression(node)) {
      return node.templateSpans.reduce(
        (value, span) => value + (fold(span.expression) ?? UNKNOWN) + span.literal.text,
        node.head.text,
      );
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      return (fold(node.left) ?? UNKNOWN) + (fold(node.right) ?? UNKNOWN);
    }
    if (ts.isCallExpression(node)) return foldCharCodes(node);
    return undefined;
  }

  /**
   * `String.fromCharCode(8212)` and `String.fromCodePoint(…)` with literal
   * arguments — the em-dash trick already on the record in RETRO.md — however
   * the member is spelled. Nothing else: a value this cannot read is unknown,
   * and it never reads an identifier, an import or a function body
   * (DECISIONS 066's revisit line — the scan must not grow an interpreter).
   */
  function foldCharCodes(node: ts.CallExpression): string | undefined {
    const method = stringMethod(node.expression);
    if (method !== "fromCharCode" && method !== "fromCodePoint") return undefined;
    const codes: number[] = [];
    for (const argument of node.arguments) {
      if (!ts.isNumericLiteral(argument)) return undefined;
      // The lexer has already normalised `0x2014` and `8_212` to a decimal
      // digit string, which is why nothing here re-implements a number parser.
      codes.push(Number(argument.text));
    }
    return method === "fromCharCode"
      ? String.fromCharCode(...codes)
      : String.fromCodePoint(...codes);
  }

  /**
   * The member name of a `String.…` call. `String["fromCharCode"]` is the same
   * call with the name hidden inside a string, and a name hidden inside a
   * string is the entire subject of this module.
   */
  function stringMethod(expression: ts.Expression): string | undefined {
    const isStringGlobal = (node: ts.Expression) => ts.isIdentifier(node) && node.text === "String";
    if (ts.isPropertyAccessExpression(expression) && isStringGlobal(expression.expression)) {
      return expression.name.text;
    }
    if (
      ts.isElementAccessExpression(expression) &&
      isStringGlobal(expression.expression) &&
      ts.isStringLiteralLike(expression.argumentExpression)
    ) {
      return expression.argumentExpression.text;
    }
    return undefined;
  }

  function foldedByParent(node: ts.Node): boolean {
    const { parent } = node;
    if (!parent) return false;
    if (ts.isParenthesizedExpression(parent) && parent.expression === node) {
      return fold(parent) !== undefined;
    }
    if (ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      return true;
    }
    if (ts.isTemplateSpan(parent) && parent.expression === node) return true;
    return false;
  }

  function visit(node: ts.Node): void {
    const value = fold(node);
    if (value !== undefined && !foldedByParent(node)) {
      const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
      out.push({ value, line });
    }
    // Descend even into a folded expression: a template span this could not
    // read became a placeholder, and the strings inside it are still strings
    // someone can hide a token in.
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return out;
}
