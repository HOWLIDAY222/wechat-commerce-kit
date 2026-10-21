import { NextResponse } from "next/server";
import { readRequestUserSession } from "@/lib/auth/session";
import { getAfterSalesForUser } from "@/lib/services/after-sales-service";

type AccountAfterSalesProps = {
  params: Promise<{ afterSalesNo: string }>;
};

export async function GET(request: Request, { params }: AccountAfterSalesProps) {
  const session = await readRequestUserSession(request);
  if (!session) {
    return NextResponse.json({ ok: false, error: "AUTH_REQUIRED" }, { status: 401 });
  }

  const { afterSalesNo } = await params;
  const afterSales = await getAfterSalesForUser(afterSalesNo, session.userId);
  if (!afterSales) {
    return NextResponse.json({ ok: false, error: "AFTER_SALES_NOT_FOUND" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, afterSales });
}
