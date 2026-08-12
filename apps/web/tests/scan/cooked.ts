import ts from "typescript";

export interface CookedString {
  value: string;
  line: number;
}

const UNKNOWN = "\0";

export function cookedStrings(source: string, fileName?: string): CookedString[] {
  const sourceFile = ts.createSourceFile(
    fileName ?? "scan.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
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
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === "String" &&
      (node.expression.name.text === "fromCharCode" ||
        node.expression.name.text === "fromCodePoint") &&
      node.arguments.every(ts.isNumericLiteral)
    ) {
      const values = node.arguments.map((argument) =>
        Number(ts.isNumericLiteral(argument) ? argument.text : Number.NaN),
      );
      return node.expression.name.text === "fromCharCode"
        ? String.fromCharCode(...values)
        : String.fromCodePoint(...values);
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
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return out;
}
