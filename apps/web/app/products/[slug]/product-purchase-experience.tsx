"use client";

import { type ReactNode, useCallback, useMemo, useState } from "react";
import { ProductImageGallery } from "@/components/product/product-image-gallery";
import { ProductPurchaseForm, type ProductPurchaseFormProps } from "@/app/products/[slug]/product-purchase-form";
import { getX1AirWhiteOfferImage } from "@/lib/commerce/x1-air-white-offers";

type ProductPurchaseExperienceProps = {
  afterForm: ReactNode;
  beforeForm: ReactNode;
  galleryImages: string[];
  productName: string;
  purchaseFormProps: Omit<ProductPurchaseFormProps, "onOfferImageChange">;
};

export function ProductPurchaseExperience({ afterForm, beforeForm, galleryImages, productName, purchaseFormProps }: ProductPurchaseExperienceProps) {
  const initialOfferImage = purchaseFormProps.productSlug === "x1-air-white" ? getX1AirWhiteOfferImage("白色", 1) : null;
  const initialImage = initialOfferImage ?? galleryImages[0] ?? "/assets/brand/product-placeholder.webp";
  const [selectedOfferImage, setSelectedOfferImage] = useState(initialImage);
  const thumbnails = useMemo(() => [...new Set([selectedOfferImage, ...galleryImages].filter(Boolean))], [galleryImages, selectedOfferImage]);

  const selectOfferImage = useCallback((image: string) => {
    setSelectedOfferImage(image);
  }, []);

  return <div className="minimal-product-layout">
    <ProductImageGallery key={selectedOfferImage} images={thumbnails} name={productName} productSlug={purchaseFormProps.productSlug} />

    <aside className="minimal-product-info">
      {beforeForm}
      <div className="py-6">
        <ProductPurchaseForm {...purchaseFormProps} onOfferImageChange={selectOfferImage} />
      </div>
      {afterForm}
    </aside>
  </div>;
}
