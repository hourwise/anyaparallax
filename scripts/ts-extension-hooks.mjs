/**
 * Node module-resolution hook used by the check runners.
 *
 * The application source uses bundler-style extensionless imports (for example
 * `./seed`), which Vite resolves but Node's ESM resolver does not. This hook
 * resolves those specifiers against the real TypeScript file so the checks can
 * import application source directly under Node's type stripping.
 */
import { access } from "node:fs/promises";

async function exists(url) {
  try {
    await access(url);
    return true;
  } catch {
    return false;
  }
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith(".") || specifier.startsWith("/")) {
    try {
      const resolved = await nextResolve(specifier, context);
      if (resolved.url.endsWith(".ts") || resolved.url.endsWith(".tsx")) {
        return { ...resolved, format: "module-typescript", shortCircuit: true };
      }
      return resolved;
    } catch (error) {
      for (const suffix of [".ts", "/index.ts"]) {
        const candidate = new URL(specifier + suffix, context.parentURL);
        if (await exists(candidate)) {
          return { url: candidate.href, format: "module-typescript", shortCircuit: true };
        }
      }
      throw error;
    }
  }
  return nextResolve(specifier, context);
}
