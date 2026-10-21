import { appConfig } from "@/lib/config";
import { prisma } from "@/lib/db/prisma";
import {
  createRuntimeAddress,
  deleteRuntimeAddress,
  listRuntimeAddresses,
  updateRuntimeAddress,
  type RuntimeAddress,
} from "@/lib/runtime-commerce";

export type AddressInput = Omit<RuntimeAddress, "id" | "userId" | "createdAt" | "updatedAt">;
export type AddressPatch = Partial<AddressInput>;

export async function listAddresses(userId: string) {
  if (appConfig.COMMERCE_STORAGE !== "prisma") {
    return listRuntimeAddresses(userId);
  }

  return prisma.address.findMany({
    where: { userId },
    orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
  });
}

export async function createAddress(userId: string, input: AddressInput) {
  if (appConfig.COMMERCE_STORAGE !== "prisma") {
    return createRuntimeAddress(userId, input);
  }

  return prisma.$transaction(async (tx) => {
    const existingCount = await tx.address.count({ where: { userId } });
    const isDefault = input.isDefault || existingCount === 0;

    if (isDefault) {
      await tx.address.updateMany({
        where: { userId, isDefault: true },
        data: { isDefault: false },
      });
    }

    return tx.address.create({
      data: {
        ...input,
        userId,
        isDefault,
      },
    });
  });
}

export async function updateAddress(userId: string, addressId: string, input: AddressPatch) {
  if (appConfig.COMMERCE_STORAGE !== "prisma") {
    return updateRuntimeAddress(userId, addressId, input);
  }

  return prisma.$transaction(async (tx) => {
    const current = await tx.address.findFirst({
      where: { id: addressId, userId },
    });
    if (!current) throw new Error("ADDRESS_NOT_FOUND");

    if (input.isDefault) {
      await tx.address.updateMany({
        where: { userId, id: { not: addressId }, isDefault: true },
        data: { isDefault: false },
      });
    }

    return tx.address.update({
      where: { id: addressId },
      data: input,
    });
  });
}

export async function deleteAddress(userId: string, addressId: string) {
  if (appConfig.COMMERCE_STORAGE !== "prisma") {
    return deleteRuntimeAddress(userId, addressId);
  }

  return prisma.$transaction(async (tx) => {
    const current = await tx.address.findFirst({
      where: { id: addressId, userId },
    });
    if (!current) throw new Error("ADDRESS_NOT_FOUND");

    const deleted = await tx.address.delete({
      where: { id: addressId },
    });

    if (current.isDefault) {
      const nextDefault = await tx.address.findFirst({
        where: { userId },
        orderBy: { createdAt: "desc" },
      });
      if (nextDefault) {
        await tx.address.update({
          where: { id: nextDefault.id },
          data: { isDefault: true },
        });
      }
    }

    return deleted;
  });
}
