import { NextResponse } from "next/server";
import { afterSalesStatuses, afterSalesTypes, canTransitionAfterSales } from "@/lib/after-sales/state-machine";

export function GET() {
  return NextResponse.json({
    ok: true,
    statuses: afterSalesStatuses,
    types: afterSalesTypes,
    examples: {
      submittedToReviewing: canTransitionAfterSales("submitted", "reviewing", "return_refund"),
      submittedToRefunded: canTransitionAfterSales("submitted", "refunded", "return_refund"),
      returnRefundMustWaitForReturn: canTransitionAfterSales("approved", "waiting_return", "return_refund"),
      refundOnlyCanProcessDirectly: canTransitionAfterSales("approved", "refund_processing", "refund_only"),
    },
  });
}
