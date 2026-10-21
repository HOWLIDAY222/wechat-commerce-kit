import "server-only";
import { revalidatePath } from "next/cache";

export function revalidateStorefront() {
  for (const path of ["/", "/shop", "/products", "/en", "/en/shop", "/en/products"]) revalidatePath(path);
  revalidatePath("/products/[slug]", "page");
  revalidatePath("/en/products/[slug]", "page");
  revalidatePath("/[pageKey]", "page");
  revalidatePath("/en/[pageKey]", "page");
}
