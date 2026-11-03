import { useState, type FormEvent } from "react";
import { LIMITS } from "../../../shared/constants";
import { genId, nameKey } from "../../../shared/format";
import { closeDialog, dispatch, setActive, setTab, toast, useStore, useT } from "../../lib/store";
import { Modal } from "../Modal";
import { Field, FormFooter } from "./common";

export function CarForm() {
  const t = useT();
  const cars = useStore((s) => s.data.cars);
  const [name, setName] = useState("");
  const [error, setError] = useState("");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const value = name.trim();
    if (!value) return setError(t.carForm.nameEmpty);
    if (cars.some((c) => nameKey(c.name) === nameKey(value))) return setError(t.carForm.duplicate);
    const id = genId();
    dispatch({ type: "car.put", data: { id, name: value } });
    setActive(id);
    setTab("service");
    closeDialog();
    toast(t.common.saved);
  };

  return (
    <Modal title={t.carForm.title} onClose={() => closeDialog()}>
      <form onSubmit={submit} noValidate>
        <Field label={t.carForm.label}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t.carForm.placeholder}
            maxLength={LIMITS.carNameLength}
          />
        </Field>
        <FormFooter error={error} submitLabel={t.carForm.submit} />
      </form>
    </Modal>
  );
}
