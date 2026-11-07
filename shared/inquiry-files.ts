import { z } from "zod";
import { customerFileInputSchema } from "../server/customers.ts";

export const inquiryFilesInputSchema = z.array(customerFileInputSchema).max(5);
export type InquiryFileInput = z.infer<typeof customerFileInputSchema>;
