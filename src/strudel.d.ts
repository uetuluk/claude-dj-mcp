// Type declarations for Strudel packages (untyped .mjs modules)

declare module "@strudel/core" {
  export function evalScope(...args: unknown[]): Promise<unknown[]>;
  export function repl(options: Record<string, unknown>): {
    scheduler: unknown;
    evaluate: (code: string, autostart?: boolean) => Promise<unknown>;
    start: () => void;
    stop: () => void;
    pause: () => void;
    setCps: (cps: number) => void;
    setPattern: (pattern: unknown, autostart?: boolean) => Promise<unknown>;
    setCode: (code: string) => void;
    toggle: () => void;
    state: Record<string, unknown>;
  };
  export const Pattern: {
    prototype: Record<string, unknown>;
  };
  export function register(name: string, fn: unknown): unknown;
  export const logger: (...args: unknown[]) => void;
  export function evaluate(
    code: string,
    transpiler?: unknown,
    options?: unknown
  ): Promise<{ pattern: unknown; meta: Record<string, unknown> }>;
}

declare module "@strudel/mini" {
  // Mini notation parser — exports are registered into evalScope
}

declare module "@strudel/tonal" {
  // Tonal functions — exports are registered into evalScope
}

declare module "@strudel/transpiler" {
  export function evaluate(
    code: string
  ): Promise<{ pattern: unknown; meta: Record<string, unknown> }>;
  export function transpiler(
    code: string,
    options?: unknown
  ): { output: string; [key: string]: unknown };
}
