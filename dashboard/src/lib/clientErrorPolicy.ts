export function isSuspectedInjectedScriptError(message: string, source: string, stack: string, filename: string, pathname: string): boolean {
  if (source !== "window-error" || !/^(?:SyntaxError:\s*)?Identifier ['"]nativeIframe['"] has already been declared$/.test(message)) return false;
  if (/(?:\/_next\/|\.m?js(?:[?:\s]|$))/i.test(stack) || !filename) return false;
  try {
    const file = new URL(filename);
    const page = new URL(pathname, file.origin);
    return /^https?:$/.test(file.protocol) && file.origin === page.origin && file.pathname === page.pathname && !/\.m?js$/i.test(file.pathname);
  } catch { return false; }
}
