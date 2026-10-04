export const ROUGH_BLOCK_VARIETIES = [
  "Kotda black",
  "R black",
  "P white",
  "Bhimana white",
  "Nadol white",
  "Ice white",
  "Khalda red",
  "Apple brown",
  "Cotton white",
  "Apple gold",
  "Chima pink",
  "Madka black",
  "Cat eyes",
  "Coin black",
] as const;
export const FINISHED_GOODS_VARIETIES = [
  "Tan brown",
  "Tan red",
  "Madampalli",
  "Rajyog",
  "Safari blue",
  "Romantic blue",
  "Lavender blue",
  "Moon white",
  "Dyna blue",
  "Ocean blue",
  "Mint pearl",
  "Flash blue",
  "Black galaxy",
] as const;
export const GRANITE_VARIETIES = [
  ...ROUGH_BLOCK_VARIETIES,
  ...FINISHED_GOODS_VARIETIES,
] as const;
export type FinishedGoodsInput = {
  reference: string;
  kind: "slab" | "countertop";
  varietyName: string;
  count: number;
  lengthFt: number;
  widthFt: number;
  thicknessMm: number;
  finish: string;
  supplierId: string;
  invoiceNo: string;
  purchaseDate: string;
  goodsTaxable: number;
  gstRatePct: number;
  paidAmount: number;
  paymentMethod: string;
  transportTaxable: number;
  transportGstRatePct: number;
  transportSupplierId?: string;
  transportInvoiceNo?: string;
  transportPaidAmount: number;
  transportPaymentMethod: string;
  clientOpId: string;
};
