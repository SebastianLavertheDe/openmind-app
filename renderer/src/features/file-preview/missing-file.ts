export function isMissingFileError(message: string | null | undefined): boolean {
  return Boolean(message && /enoent|not found|no such file|does not exist|找不到|不存在/i.test(message));
}
