import { useState, type ChangeEvent, type FormEvent } from "react";
import {
  BODY_TYPES,
  FUEL_TYPES,
  maxCarYear,
  normalizeVin,
  parseProfileForm,
  profileDraft,
  type ProfileDraft,
} from "../../../shared/carProfile";
import { LIMITS } from "../../../shared/constants";
import { todayISO } from "../../../shared/format";
import { closeDialog, dispatch, toast, useStore, useT } from "../../lib/store";
import { Modal } from "../Modal";
import { Field, FormFooter } from "./common";

type Input = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

/** Профіль машини: усе необов'язкове й зберігається разом окремою операцією, тож перейменування його не зачепить. */
export function CarProfileForm({ carId }: { carId: string }) {
  const t = useT();
  const car = useStore((s) => s.data.cars.find((c) => c.id === carId));
  const [draft, setDraft] = useState<ProfileDraft>(() => profileDraft(car?.profile));
  const [error, setError] = useState("");
  if (!car) return null;

  const p = t.carProfile;
  const today = todayISO();
  const set = (key: keyof ProfileDraft) => (e: ChangeEvent<Input>) => {
    const value = e.target.value;
    setDraft((d) => ({ ...d, [key]: value }));
  };
  const vin = normalizeVin(draft.vin);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const parsed = parseProfileForm(draft, today);
    if (!parsed.ok) return setError(parsed.error === "errYear" ? p.errYear(maxCarYear(today)) : p[parsed.error]);
    dispatch({ type: "car.profile", id: car.id, data: parsed.profile });
    closeDialog();
    toast(t.common.saved);
  };

  return (
    <Modal title={p.title} onClose={() => closeDialog()}>
      <form onSubmit={submit} noValidate>
        <p className="muted">{car.name}</p>
        <div className="field-row">
          <Field label={p.plate}>
            <input
              className="input-caps"
              value={draft.plate}
              onChange={set("plate")}
              maxLength={LIMITS.plateLength}
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
            />
          </Field>
          <Field label={p.year}>
            <input
              inputMode="numeric"
              value={draft.year}
              onChange={set("year")}
              maxLength={4}
              placeholder={p.yearPlaceholder}
            />
          </Field>
        </div>
        <Field label={p.vin} hint={vin && vin.length !== 17 ? p.vinHint : undefined}>
          <input
            className="input-caps"
            value={draft.vin}
            onChange={set("vin")}
            maxLength={24}
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
          />
        </Field>
        <Field label={p.body}>
          <select value={draft.body} onChange={set("body")}>
            <option value="">{p.notSet}</option>
            {BODY_TYPES.map((body) => (
              <option key={body} value={body}>
                {p.bodies[body]}
              </option>
            ))}
          </select>
        </Field>
        <div className="field-row">
          <Field label={p.engine}>
            <input
              inputMode="decimal"
              value={draft.engine}
              onChange={set("engine")}
              placeholder={p.enginePlaceholder}
            />
          </Field>
          <Field label={p.fuelType}>
            <select value={draft.fuelType} onChange={set("fuelType")}>
              <option value="">{p.notSet}</option>
              {FUEL_TYPES.map((fuel) => (
                <option key={fuel} value={fuel}>
                  {p.fuels[fuel]}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="field-row">
          <Field label={p.purchaseDate}>
            <input type="date" max={today} value={draft.purchaseDate} onChange={set("purchaseDate")} />
          </Field>
          <Field label={p.purchasePrice}>
            <input inputMode="decimal" value={draft.purchasePrice} onChange={set("purchasePrice")} />
          </Field>
        </div>
        <Field label={p.about}>
          <textarea
            rows={3}
            value={draft.about}
            onChange={set("about")}
            placeholder={p.aboutPlaceholder}
            maxLength={LIMITS.carAboutLength}
          />
        </Field>
        <FormFooter error={error} />
      </form>
    </Modal>
  );
}
