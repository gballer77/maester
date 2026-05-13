import * as clack from "@clack/prompts";
import type { Theming } from "./theme/index.js";

export class PromptCancelledError extends Error {
  constructor(message = "Prompt cancelled") {
    super(message);
    this.name = "PromptCancelledError";
  }
}

function ensure<T>(value: T | symbol): T {
  if (clack.isCancel(value)) {
    throw new PromptCancelledError();
  }
  return value;
}

type Spinner = ReturnType<typeof clack.spinner>;

type ClackSelectOpts<T extends string> = Parameters<typeof clack.select<T>>[0];
type ClackMultiselectOpts<T extends string> = Parameters<typeof clack.multiselect<T>>[0];
type ClackOption<T extends string> = ClackSelectOpts<T>["options"][number];

function buildOption<T extends string>(o: {
  value: T;
  label: string;
  hint?: string;
}): ClackOption<T> {
  const base: { value: T; label: string } = { value: o.value, label: o.label };
  return (o.hint === undefined ? base : { ...base, hint: o.hint }) as ClackOption<T>;
}

export type Prompts = {
  intro: (title: string) => void;
  outro: (message: string) => void;
  note: (title: string, body?: string) => void;
  log: {
    message: (m: string) => void;
    success: (m: string) => void;
    warning: (m: string) => void;
    error: (m: string) => void;
    info: (m: string) => void;
  };
  text: (opts: {
    message: string;
    placeholder?: string;
    initialValue?: string;
    validate?: (v: string) => string | undefined;
  }) => Promise<string>;
  confirm: (opts: { message: string; initialValue?: boolean }) => Promise<boolean>;
  select: <T extends string>(opts: {
    message: string;
    options: { value: T; label: string; hint?: string }[];
    initialValue?: T;
  }) => Promise<T>;
  multiselect: <T extends string>(opts: {
    message: string;
    options: { value: T; label: string; hint?: string }[];
    initialValues?: T[];
    required?: boolean;
  }) => Promise<T[]>;
  group: typeof clack.group;
  spinner: () => Spinner;
  raw: typeof clack;
};

export function createPrompts(theming: Theming): Prompts {
  void theming;
  return {
    intro: (title) => clack.intro(title),
    outro: (message) => clack.outro(message),
    note: (title, body) => clack.note(body ?? "", title),
    log: {
      message: (m) => clack.log.message(m),
      success: (m) => clack.log.success(m),
      warning: (m) => clack.log.warning(m),
      error: (m) => clack.log.error(m),
      info: (m) => clack.log.info(m),
    },
    text: async (opts) => {
      const validateAdapter = opts.validate
        ? (v: string | undefined) => {
            const result = opts.validate?.(v ?? "");
            return result ?? undefined;
          }
        : undefined;
      const baseOpts = {
        message: opts.message,
        ...(opts.placeholder !== undefined ? { placeholder: opts.placeholder } : {}),
        ...(opts.initialValue !== undefined ? { initialValue: opts.initialValue } : {}),
        ...(validateAdapter ? { validate: validateAdapter } : {}),
      };
      const result = await clack.text(baseOpts);
      const checked = ensure(result);
      return checked ?? "";
    },
    confirm: async (opts) => {
      const result = await clack.confirm({
        message: opts.message,
        ...(opts.initialValue !== undefined ? { initialValue: opts.initialValue } : {}),
      });
      return ensure(result);
    },
    select: async <T extends string>(opts: {
      message: string;
      options: { value: T; label: string; hint?: string }[];
      initialValue?: T;
    }) => {
      const options = opts.options.map(buildOption<T>);
      const params = {
        message: opts.message,
        options,
        ...(opts.initialValue !== undefined ? { initialValue: opts.initialValue } : {}),
      } as ClackSelectOpts<T>;
      const result = await clack.select<T>(params);
      return ensure(result);
    },
    multiselect: async <T extends string>(opts: {
      message: string;
      options: { value: T; label: string; hint?: string }[];
      initialValues?: T[];
      required?: boolean;
    }) => {
      const options = opts.options.map(buildOption<T>);
      const params = {
        message: opts.message,
        options,
        ...(opts.initialValues !== undefined ? { initialValues: opts.initialValues } : {}),
        ...(opts.required !== undefined ? { required: opts.required } : {}),
      } as ClackMultiselectOpts<T>;
      const result = await clack.multiselect<T>(params);
      return ensure(result);
    },
    group: clack.group,
    spinner: () => clack.spinner(),
    raw: clack,
  };
}
