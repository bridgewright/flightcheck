import { formatOrderAmount, formatOrderDate, orderStatusLabel } from "@/lib/home";
import { EMPTY_RULE, LABEL, MUTED, TABLE_ROW } from "@/lib/ui";
import type { OrderRow } from "@/lib/types";
import { listOrders } from "@/lib/worker";

// The receipts list: one row per Polar order, newest first (the worker's
// GET /api/orders serializes them in that order already). Rendered by the
// settings page.
//
// Server component: orders ride the same bearer-authenticated worker channel
// as everything else and never reach the browser as an API.

function Row({ order }: { order: OrderRow }) {
  return (
    <tr className={TABLE_ROW}>
      <td className="py-2.5 pr-4 whitespace-nowrap">
        {formatOrderDate(order.created_at) ?? (
          <span className={EMPTY_RULE} aria-hidden="true" />
        )}
      </td>
      <td className="py-2.5 pr-4 tabular-nums whitespace-nowrap">
        {formatOrderAmount(order.amount_minor, order.currency) ?? (
          <span className={EMPTY_RULE} aria-hidden="true" />
        )}
      </td>
      <td className={`py-2.5 ${MUTED}`}>
        {orderStatusLabel(order.status) ?? (
          <span className={EMPTY_RULE} aria-hidden="true" />
        )}
      </td>
    </tr>
  );
}

export default async function OrderHistory({ userId }: { userId: string }) {
  let orders: OrderRow[];
  try {
    orders = await listOrders(userId);
  } catch {
    return (
      <p className={`text-fine ${MUTED}`}>
        Your payment history can&apos;t be loaded right now. Nothing is lost.
        Try again in a moment.
      </p>
    );
  }

  if (orders.length === 0) {
    return (
      <p className={`text-fine ${MUTED}`}>
        No payments yet. When you unlock a package, the receipt appears here.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-fine">
        <thead>
          <tr>
            <th className={`${LABEL} py-1.5 pr-4`}>Date</th>
            <th className={`${LABEL} py-1.5 pr-4`}>Amount</th>
            <th className={`${LABEL} py-1.5`}>Status</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => (
            <Row key={order.id} order={order} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
