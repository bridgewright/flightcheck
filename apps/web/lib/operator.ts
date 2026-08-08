export function isOperator(
  viewerId: string | null | undefined,
  operatorUserId: string | null | undefined,
): boolean {
  const viewer = viewerId?.trim();
  const operator = operatorUserId?.trim();
  return Boolean(viewer && operator && viewer === operator);
}
