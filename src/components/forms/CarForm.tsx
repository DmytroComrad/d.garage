import { useState, type FormEvent } from "react";
import { LIMITS } from "../../../shared/constants";
import { genId, nameKey } from "../../../shared/format";
import { closeDialog, dispatch, setActive, setTab, toast, useStore } from "../../lib/store";
import { Modal } from "../Modal";
import { Field, FormFooter } from "./common";

export function CarForm() {
  const cars = useStore((s) => s.data.cars);
  const [name, setName] = useState("");
  const [error, setError] = useState("");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const value = name.trim();
    if (!value) return setError("Напиши название.");
    if (cars.some((c) => nameKey(c.name) === nameKey(value))) return setError("Такая машина уже есть.");
    const id = genId();
    dispatch({ type: "car.put", data: { id, name: value } });
    setActive(id);
    setTab("service");
    closeDialog();
    toast("Сохранено");
  };

  return (
    <Modal title="Новая машина" onClose={() => closeDialog()}>
      <form onSubmit={submit} noValidate>
        <Field label="Как называешь машину">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Например: Крыся, Пассат, Рабочая"
            maxLength={LIMITS.carNameLength}
          />
        </Field>
        <FormFooter error={error} submitLabel="Добавить машину" />
      </form>
    </Modal>
  );
}
