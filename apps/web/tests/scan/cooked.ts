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

/**
 * The named character references the JSX compiler decodes AND a rule reads.
 *
 * `<p>a &mdash; b</p>` ships a real em dash: the reference is resolved by the
 * JSX transform, so the em-dash gate saw `&mdash;`, found no dash, and passed a
 * sentence that reaches the reader with one. Both scans missed it — the per-line
 * pass reads the same raw text this one did — and `className="bg&#45;red&#45;500"`
 * is the same escape pointed at the palette rule.
 *
 * The set is short because it is complete against the rules rather than against
 * HTML: a reference the compiler resolves to a character no rule reads cannot
 * change a verdict, which is why the ones this product actually writes —
 * `&apos;`, `&rsquo;`, `&ldquo;`, `&rdquo;`, `&hellip;`, `&amp;` — are
 * deliberately absent. That the product spells its typography this way is also
 * why the gap is worth closing: an author following the house convention who
 * wants a dash writes `&mdash;`, and nothing was reading it.
 *
 * Which references the compiler resolves was read off the production bundle
 * rather than assumed, and the punctuation names are NOT resolved by it —
 * `&num;`, `&colon;`, `&period;`, `&lbrack;`, `&rbrack;`, `&lpar;`, `&hyphen;`,
 * `&sol;`, `&dash;` and `&lowbar;` all ship verbatim — so decoding them here
 * would report characters the reader never receives. The numeric form of every
 * one of them is covered below, which is the half that can spell anything.
 */
const NAMED_REFERENCES: Record<string, string> = {
  mdash: "—",
  ndash: "–",
  // Matched by `\s`, which the whole-value hex rule anchors on.
  nbsp: " ",
};

/**
 * Numeric references are decoded in full, since one can spell any character —
 * `&#45;` is the hyphen that rebuilds `bg-red-500`. An out-of-range code point
 * is left verbatim rather than thrown, because this runs over real source and a
 * scan that crashes on a typo is a scan nobody can leave in the gate.
 */
function decodeReferences(text: string): string {
  return text.replace(
    /&(?:#[xX]([0-9a-fA-F]+)|#(\d+)|([a-zA-Z][a-zA-Z0-9]*));/g,
    (reference, hex: string | undefined, decimal: string | undefined, name: string | undefined) => {
      if (hex !== undefined) return fromCodePoint(parseInt(hex, 16)) ?? reference;
      if (decimal !== undefined) return fromCodePoint(Number(decimal)) ?? reference;
      return (name !== undefined ? NAMED_REFERENCES[name] : undefined) ?? reference;
    },
  );
}

function fromCodePoint(value: number): string | undefined {
  return Number.isInteger(value) && value >= 0 && value <= 0x10ffff
    ? String.fromCodePoint(value)
    : undefined;
}

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
      // A JSX attribute's string value is decoded by the compiler; an ordinary
      // string is not, and neither is a template inside `{…}`. Decoding those
      // would report a class that matches nothing as a raw palette utility.
      return isJsxAttributeValue(node) ? decodeReferences(node.text) : node.text;
    }
    if (ts.isJsxText(node)) return decodeReferences(node.text);
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

  function isJsxAttributeValue(node: ts.Node): boolean {
    const { parent } = node;
    return parent !== undefined && ts.isJsxAttribute(parent) && parent.initializer === node;
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
