import { useEffect, useId, useRef, type ReactNode } from "react";
import { CloseIcon } from "./icons";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Чи ставити фокус у перше поле: на телефоні це відкрило б клавіатуру поверх форми. */
export const isDesktop = (): boolean => window.matchMedia("(min-width: 640px) and (hover: hover)").matches;

type Props = {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  alert?: boolean;
  wide?: boolean;
};

export function Modal({ title, onClose, children, footer, alert, wide }: Props) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const node = panel.current;
    if (node && isDesktop()) {
      const first = node.querySelector<HTMLElement>(
        ".modal-body input:not([type=checkbox]), .modal-body textarea, .modal-body select",
      );
      (first ?? node).focus();
    } else {
      node?.focus();
    }
    document.documentElement.classList.add("is-modal");

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        closeRef.current();
      }
      if (e.key === "Tab" && node) {
        const items = [...node.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
        if (!items.length) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && (document.activeElement === first || document.activeElement === node)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.documentElement.classList.remove("is-modal");
      before?.focus?.();
    };
  }, []);

  return (
    <div className="modal-root">
      <div className="modal-backdrop" onClick={onClose} />
      <div
        ref={panel}
        className={`modal${wide ? " modal-wide" : ""}`}
        role={alert ? "alertdialog" : "dialog"}
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <header className="modal-head">
          <h2 id={titleId} className="modal-title">
            {title}
          </h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Закрыть">
            <CloseIcon />
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>
  );
}
