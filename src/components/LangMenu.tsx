import { useEffect, useRef, useState, type KeyboardEvent, type ReactElement } from "react";
import { LANG_NAMES } from "../../shared/i18n";
import { LANGS, type Lang } from "../../shared/prefs";
import { setPrefs, useStore, useT } from "../lib/store";
import { CheckIcon, FlagBlank, FlagEn, FlagUk } from "./icons";

const FLAGS: Record<Lang, () => ReactElement> = { en: FlagEn, uk: FlagUk, ru: FlagBlank };
const CODES: Record<Lang, string> = { en: "EN", uk: "UA", ru: "ru" };

/** Перемикач мови поруч із профілем. Вибір живе на пристрої, як і тема. */
export function LangMenu() {
  const t = useT();
  const lang = useStore((s) => s.prefs.lang);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const node = root.current;
    node?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
    const onDown = (e: PointerEvent) => {
      if (!node?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const onMenuKey = (e: KeyboardEvent<HTMLUListElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = [...e.currentTarget.querySelectorAll<HTMLButtonElement>("button")];
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    items[(i + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus();
  };

  const Current = FLAGS[lang];
  return (
    <div className="lang" ref={root}>
      <button
        ref={button}
        type="button"
        className="lang-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${t.lang.choose}: ${LANG_NAMES[lang]}`}
        onClick={() => setOpen(!open)}
      >
        <Current />
        <span className="lang-code">{CODES[lang]}</span>
      </button>
      {open && (
        <ul className="lang-menu" role="menu" aria-label={t.lang.choose} onKeyDown={onMenuKey}>
          {LANGS.map((l) => {
            const Flag = FLAGS[l];
            return (
              <li key={l} role="none">
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={l === lang}
                  onClick={() => {
                    setPrefs({ lang: l });
                    setOpen(false);
                    button.current?.focus();
                  }}
                >
                  <Flag />
                  <span>{LANG_NAMES[l]}</span>
                  {l === lang && <CheckIcon size={16} />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
