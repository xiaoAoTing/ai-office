/**
 * Interface languages: English (default), Russian and Chinese. Every string the interface shows comes from
 * `en.ts` / `ru.ts` / `zh.ts`; `ru` and `zh` are typed by the shape of `en`, so a missing or extra key does not
 * compile (and `npm run check:i18n` also compares placeholders). Strings use `{name}` and a small plural form:
 * `{count, plural, one {# task} other {# tasks}}` (Russian adds `few` and `many`, Chinese only `other`).
 * Numbers in parameters are formatted for the language. The choice lives in the browser (`localStorage`),
 * English until changed.
 */
import { useCallback } from "react";
import { create } from "zustand";
import { en } from "./en";
import { ru } from "./ru";
import { zh } from "./zh";

export type Lang = "en" | "ru" | "zh";
export const LANGS: Lang[] = ["en", "ru", "zh"];
const LOCALE: Record<Lang, string> = { en: "en-GB", ru: "ru-RU", zh: "zh-CN" };
const STORAGE_KEY = "ai-office-lang";

type Leaves<T, P extends string = ""> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Leaves<T[K], `${P}${K}.`>;
}[keyof T & string];

/** Every key of the dictionaries, e.g. `"taskStatus.done"`. */
export type Key = Leaves<typeof en>;
export type Params = Record<string, string | number>;
export type T = (key: Key, params?: Params) => string;

const DICTS: Record<Lang, unknown> = { en, ru, zh };

function lookup(dict: unknown, key: string): string | undefined {
  let node: unknown = dict;
  for (const part of key.split(".")) {
    if (node === null || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string" ? node : undefined;
}

const PLURAL = /\{(\w+), plural,((?:\s*\w+\s*\{[^{}]*\})+)\s*\}/g;
const FORM = /(\w+)\s*\{([^{}]*)\}/g;
const PARAM = /\{(\w+)\}/g;

/** Fills `{name}` and plural forms in a dictionary string. */
export function format(text: string, params: Params = {}, lang: Lang = "en"): string {
  const numbers = new Intl.NumberFormat(LOCALE[lang]);
  const show = (v: string | number) => (typeof v === "number" ? numbers.format(v) : v);
  const rules = new Intl.PluralRules(LOCALE[lang]);
  const withPlurals = text.replace(PLURAL, (_, name: string, body: string) => {
    const value = Number(params[name] ?? 0);
    const forms = Object.fromEntries([...body.matchAll(FORM)].map((m) => [m[1], m[2]]));
    const form = forms[rules.select(value)] ?? forms.other ?? "";
    return form.replace(/#/g, numbers.format(value));
  });
  return withPlurals.replace(PARAM, (whole, name: string) => (name in params ? show(params[name]) : whole));
}

export function translate(lang: Lang, key: Key, params?: Params): string {
  const raw = lookup(DICTS[lang], key) ?? lookup(DICTS.en, key) ?? key;
  return format(raw, params, lang);
}

/** A key built at run time (a code from the backend); `undefined` when the dictionary has no such key. */
export function tryTranslate(lang: Lang, key: string, params?: Params): string | undefined {
  const raw = lookup(DICTS[lang], key);
  return raw === undefined ? undefined : format(raw, params, lang);
}

function stored(): Lang | null {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value === "en" || value === "ru" || value === "zh" ? value : null;
  } catch {
    return null;
  }
}

type LangState = { lang: Lang; setLang: (lang: Lang) => void; restore: () => void };

export const useLangStore = create<LangState>((set) => ({
  lang: "en",
  setLang: (lang) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      /* private mode: the choice lasts for this page only */
    }
    document.documentElement.lang = lang;
    set({ lang });
  },
  restore: () => {
    const lang = stored();
    if (lang) {
      document.documentElement.lang = lang;
      set({ lang });
    }
  },
}));

/** The translate function for the current language; components using it re-render when the language changes. */
export function useT(): T {
  const lang = useLangStore((s) => s.lang);
  return useCallback((key: Key, params?: Params) => translate(lang, key, params), [lang]);
}

export function useLang(): Lang {
  return useLangStore((s) => s.lang);
}

/** Dates and numbers in the current language. */
export function formatters(lang: Lang) {
  const dateFmt = new Intl.DateTimeFormat(LOCALE[lang], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const numberFmt = new Intl.NumberFormat(LOCALE[lang]);
  return {
    date: (iso: string | null) => (iso ? dateFmt.format(new Date(iso)) : "—"),
    number: (n: number) => numberFmt.format(n),
    decimal: (n: number, digits: number) => new Intl.NumberFormat(LOCALE[lang], { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n),
  };
}

export function useFormat() {
  const lang = useLangStore((s) => s.lang);
  return formatters(lang);
}

export function currentLang(): Lang {
  return useLangStore.getState().lang;
}
