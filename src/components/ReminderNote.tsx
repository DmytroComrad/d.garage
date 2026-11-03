import { useState } from "react";
import { fmtUnits } from "../../shared/format";
import { dismissReminderNote, useStore, useT } from "../lib/store";
import { InfoIcon } from "./icons";

/** Приклад у вибраних одиницях: числа мають бути круглими й для кілометрів, і для миль. */
const EXAMPLE = {
  km: { last: 99_800, due: 100_000, next: 100_300 },
  mi: { last: 59_850, due: 60_000, next: 60_200 },
} as const;

/**
 * Як саме спрацьовують нагадування. Розгорнуте пояснення показуємо, доки людина не натисне «Зрозуміло»
 * (на цьому пристрої), а далі воно відкривається посиланням.
 */
export function ReminderNote() {
  const t = useT();
  const seen = useStore((s) => s.reminderNoteSeen);
  const unit = useStore((s) => s.prefs.unit);
  const [open, setOpen] = useState(false);

  if (seen && !open) {
    return (
      <button type="button" className="link-btn note-link" onClick={() => setOpen(true)}>
        <InfoIcon size={16} /> {t.reminderNote.link}
      </button>
    );
  }

  const n = t.reminderNote;
  const ex = EXAMPLE[unit];
  return (
    <section className="note" aria-label={n.title}>
      <p className="note-title">
        <InfoIcon size={18} /> <strong>{n.title}</strong>
      </p>
      <p>
        <strong>{n.kmTitle}.</strong> {n.kmText}
      </p>
      <p>{n.kmExample(fmtUnits(ex.last), fmtUnits(ex.due), fmtUnits(ex.next), fmtUnits(ex.next - ex.due))}</p>
      <p className="muted">{n.kmTip}</p>
      <p>
        <strong>{n.dateTitle}.</strong> {n.dateText}
      </p>
      <p className="muted">{n.once}</p>
      <div>
        <button
          type="button"
          className="btn btn-ink btn-small"
          onClick={() => {
            dismissReminderNote();
            setOpen(false);
          }}
        >
          {t.common.gotIt}
        </button>
      </div>
    </section>
  );
}
