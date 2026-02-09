/** Extensions eligible for RAG file search (text/document/code only) */
export const RAG_ELIGIBLE_EXTENSIONS = new Set([
  // text
  ".md", ".txt", ".csv", ".tsv", ".json", ".xml", ".html", ".yaml", ".yml",
  // code
  ".js", ".ts", ".jsx", ".tsx", ".py", ".java", ".rb", ".go", ".rs",
  ".c", ".cpp", ".h", ".cs", ".php", ".dart", ".sql", ".sh",
  // documents
  ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".pptx",
]);

/** Check if a file name is eligible for RAG based on extension */
export function isRagEligible(fileName: string): boolean {
  const dot = fileName.lastIndexOf(".");
  if (dot < 0) return false;
  return RAG_ELIGIBLE_EXTENSIONS.has(fileName.slice(dot).toLowerCase());
}
