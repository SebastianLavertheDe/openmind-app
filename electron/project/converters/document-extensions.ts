/**
 * Pure data shared by the main process and the document conversion worker.
 * Kept free of any heavy imports: main-process modules only need the
 * extension list, while document-converter-core (mammoth/pdf-parse/turndown)
 * must stay loadable in the worker without being pulled into the main
 * process through a value-import chain.
 */
export const SUPPORTED_DOCUMENT_EXTENSIONS = [".pdf", ".docx", ".pptx", ".xlsx"] as const;
