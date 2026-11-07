import { z } from "zod";
import { customerAttachmentSchema, customerFileLimit } from "../server/customers.ts";

export const inquiryFileInputSchema = customerAttachmentSchema.omit({ id: true, size: true }).extend({
  data: z.string().max(Math.ceil(customerFileLimit / 3) * 4).regex(/^[A-Za-z0-9+/]*={0,2}$/),
}).strict();
export const inquiryFilesInputSchema = z.array(inquiryFileInputSchema).max(5);
export type InquiryFileInput = z.infer<typeof inquiryFileInputSchema>;
