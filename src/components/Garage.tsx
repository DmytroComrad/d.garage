import { useEffect, useRef, useState } from "react";
import { carSummary, fuelSummary } from "../../shared/calc";
import { fmtConsumption, fmtDate, fmtKm, fmtMoney, fmtMoney0, todayISO } from "../../shared/format";
import { reminderText, sortReminders } from "../../shared/reminders";
import { carRecords, dispatch, loadDemo, markReminderDone, openDialog, setActive, setTab, toast, useApp, type Tab } from "../lib/store";
import { DataTab } from "./DataTab";
import { FuelTab } from "./FuelTab";
import { GalleryTab } from "./GalleryTab";
import { LampIcon, PersonIcon } from "./icons";
import { Mono } from "./Mono";
import { Odometer } from "./Odometer";
import { RemindersTab } from "./RemindersTab";
import { ServiceTab } from "./ServiceTab";
import { StatsTab } from "./StatsTab";

function TopBar() {
  const { data, active, user } = useApp();
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <div className="brand" aria-label="Гараж Амедро">
          <span>Гараж</span> <span className="brand-accent">Амедро</span>
        </div>
        <nav className="car-chips" aria-label="Машины">
          {data.cars.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`car-chip${c.id === active ? " is-on" : ""}`}
              aria-pressed={c.id === active}
              onClick={() => setActive(c.id)}
            >
              {c.name}
            </button>
          ))}
          <button type="button" className="car-chip car-chip-add" onClick={() => openDialog({ type: "car" })}>
            + машина
          </button>
        </nav>
        <button
          type="button"
          className="icon-btn account-btn"
          aria-label={`Профиль: ${user?.name || user?.email}`}
          onClick={() => openDialog({ type: "account" })}
        >
          <PersonIcon />
        </button>
      </div>
    </header>
  );
}

function Banners() {
  const { data, offline, queue, storageOk } = useApp();
  return (
    <>
      {data.demo && (
        <div className="banner">
          <p>
            <strong>Это пример гаража.</strong> Если хочешь, оставь эти записи. Если нет, начни с чистого гаража.
          </p>
          <div className="banner-actions">
            <button
              type="button"
              className="btn btn-ink btn-small"
              onClick={() => {
                dispatch({ type: "demo.set", value: false });
                toast("Записи сохранены за тобой");
              }}
            >
              Оставить
            </button>
            <button
              type="button"
              className="btn btn-quiet btn-small"
              onClick={() => {
                dispatch({ type: "all.del" });
                openDialog({ type: "car" });
              }}
            >
              Начать с нуля
            </button>
          </div>
        </div>
      )}
      {offline && (
        <div className="banner banner-quiet" role="status">
          <p>
            <strong>Нет связи с сервером.</strong>{" "}
            {queue.length
              ? `Несохранённых изменений: ${queue.length}. Отправятся сами, когда появится интернет.`
              : "Показаны последние сохранённые данные."}
          </p>
        </div>
      )}
      {!storageOk && (
        <div className="banner banner-bad" role="alert">
          <p>
            <strong>Браузер не даёт сохранять данные.</strong> Пока нет интернета, изменения пропадут после закрытия
            страницы. Скачай бэкап на вкладке «Данные».
          </p>
        </div>
      )}
    </>
  );
}

function EmptyGarage() {
  return (
    <section className="empty-garage">
      <h1 className="display">Гараж пуст</h1>
      <p>Добавь машину — и веди ремонты, покупки и заправки. Расход, вложения и цена километра посчитаются сами.</p>
      <div className="empty-actions">
        <button type="button" className="btn btn-ink" onClick={() => openDialog({ type: "car" })}>
          Добавить машину
        </button>
        <button type="button" className="btn btn-quiet" onClick={() => setTab("data")}>
          Восстановить из бэкапа
        </button>
        <button type="button" className="btn btn-quiet" onClick={loadDemo}>
          Посмотреть на примере
        </button>
      </div>
    </section>
  );
}

function ReminderStrip({ carId }: { carId: string }) {
  const { data } = useApp();
  const { service, fuel, reminders } = carRecords(data, carId);
  const today = todayISO();
  const odo = carSummary(service, fuel, today).currentOdo;
  const rows = sortReminders(
    reminders.filter((r) => !r.done),
    odo,
    today,
  ).filter((r) => r.status.level > 0);
  if (!rows.length) return null;
  const shown = rows.slice(0, 3);
  return (
    <section className="lamps" aria-label="Скоро обслуживание">
      {shown.map(({ reminder, status }) => (
        <div key={reminder.id} className={`lamp lamp-${status.level}`}>
          <span className="lamp-icon">
            <LampIcon />
          </span>
          <button type="button" className="lamp-text" onClick={() => openDialog({ type: "reminder", reminder })}>
            <Mono text={reminderText(status, reminder.title)} />
          </button>
          <button type="button" className="btn btn-small btn-quiet" onClick={() => markReminderDone(reminder)}>
            Сделано
          </button>
        </div>
      ))}
      {rows.length > shown.length && (
        <button type="button" className="link-btn" onClick={() => setTab("reminders")}>
          Все напоминания: {rows.length}
        </button>
      )}
    </section>
  );
}

function Hero({ carId, actionsRef }: { carId: string; actionsRef: React.RefObject<HTMLDivElement | null> }) {
  const { data } = useApp();
  const car = data.cars.find((c) => c.id === carId);
  const { service, fuel } = carRecords(data, carId);
  const s = carSummary(service, fuel, todayISO());
  const f = fuelSummary(fuel);

  return (
    <section className="hero">
      <div className="hero-top">
        <div className="hero-title">
          <h1 className="display">{car?.name}</h1>
          <p className="hero-sub">
            <Mono text={s.hasRecords ? `Учёт с ${fmtDate(s.since)} · проехано ${fmtKm(s.driven)}` : "Пока нет записей"} />
          </p>
        </div>
        <Odometer value={s.currentOdo} />
      </div>
      <div ref={actionsRef} className="hero-actions">
        <button type="button" className="btn btn-fuel" onClick={() => openDialog({ type: "fuel", car: carId })}>
          + Заправка
        </button>
        <button type="button" className="btn btn-service" onClick={() => openDialog({ type: "service", car: carId })}>
          + Сервис
        </button>
      </div>
      <dl className="gauges">
        <div className="gauge gauge-main">
          <dt>Вложено всего</dt>
          <dd>{fmtMoney0(s.total)}</dd>
        </div>
        <div className="gauge">
          <dt>Сервис и покупки</dt>
          <dd>{fmtMoney0(s.serviceTotal)}</dd>
        </div>
        <div className="gauge">
          <dt>Топливо</dt>
          <dd>{fmtMoney0(s.fuelTotal)}</dd>
        </div>
        <div className="gauge">
          <dt>Средний расход</dt>
          <dd>{fmtConsumption(f.avg)}</dd>
        </div>
        <div className="gauge">
          <dt>1 км обходится</dt>
          <dd>{fmtMoney(s.perKm)}</dd>
        </div>
      </dl>
    </section>
  );
}

function Tabs({ carId }: { carId: string }) {
  const { tab, data } = useApp();
  const { service, fuel, reminders } = carRecords(data, carId);
  const today = todayISO();
  const odo = carSummary(service, fuel, today).currentOdo;
  const urgent = sortReminders(
    reminders.filter((r) => !r.done),
    odo,
    today,
  ).filter((r) => r.status.level > 0).length;

  const items: { id: Tab; label: string; badge?: number }[] = [
    { id: "service", label: "Обслуживание" },
    { id: "fuel", label: "Заправки" },
    { id: "reminders", label: "Напоминания", badge: urgent },
    { id: "gallery", label: "Галерея" },
    { id: "stats", label: "Статистика" },
    { id: "data", label: "Данные" },
  ];

  // На телефоні вкладки гортаються: вибрана не має лишатися за краєм.
  useEffect(() => {
    document.getElementById(`tab-${tab}`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [tab]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const i = items.findIndex((x) => x.id === tab);
    const next = items[(i + (e.key === "ArrowRight" ? 1 : items.length - 1)) % items.length];
    setTab(next.id);
    requestAnimationFrame(() => document.getElementById(`tab-${next.id}`)?.focus());
  };

  return (
    <div className="tabs-wrap">
      <div className="tabs" role="tablist" aria-label="Разделы" onKeyDown={onKey}>
        {items.map((item) => (
          <button
            key={item.id}
            id={`tab-${item.id}`}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            aria-controls="tab-panel"
            tabIndex={tab === item.id ? 0 : -1}
            className={`tab${tab === item.id ? " is-on" : ""}`}
            onClick={() => setTab(item.id)}
          >
            {item.label}
            {item.badge ? <span className="tab-badge">{item.badge}</span> : null}
          </button>
        ))}
      </div>
    </div>
  );
}

/** На телефоні кнопки додавання завжди під рукою, навіть коли hero вже за межами екрана. */
function QuickBar({ carId, actionsRef }: { carId: string; actionsRef: React.RefObject<HTMLDivElement | null> }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const node = actionsRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(!entry.isIntersecting), { threshold: 0 });
    observer.observe(node);
    return () => observer.disconnect();
  }, [actionsRef, carId]);

  return (
    <div className={`quickbar${visible ? " is-on" : ""}`} aria-hidden={!visible}>
      <button
        type="button"
        className="btn btn-fuel"
        tabIndex={visible ? 0 : -1}
        onClick={() => openDialog({ type: "fuel", car: carId })}
      >
        + Заправка
      </button>
      <button
        type="button"
        className="btn btn-service"
        tabIndex={visible ? 0 : -1}
        onClick={() => openDialog({ type: "service", car: carId })}
      >
        + Сервис
      </button>
    </div>
  );
}

export function Garage() {
  const { data, active, tab } = useApp();
  const actionsRef = useRef<HTMLDivElement>(null);
  const carId = active && data.cars.some((c) => c.id === active) ? active : null;

  return (
    <>
      <TopBar />
      <main className="container">
        <Banners />
        {!carId ? (
          <>
            <EmptyGarage />
            {tab === "data" && <DataTab />}
          </>
        ) : (
          <>
            <Hero carId={carId} actionsRef={actionsRef} />
            <ReminderStrip carId={carId} />
            <Tabs carId={carId} />
            <div id="tab-panel" role="tabpanel" aria-labelledby={`tab-${tab}`} className="tab-panel">
              {tab === "service" && <ServiceTab carId={carId} />}
              {tab === "fuel" && <FuelTab carId={carId} />}
              {tab === "reminders" && <RemindersTab carId={carId} />}
              {tab === "gallery" && <GalleryTab carId={carId} />}
              {tab === "stats" && <StatsTab carId={carId} />}
              {tab === "data" && <DataTab />}
            </div>
            <QuickBar carId={carId} actionsRef={actionsRef} />
          </>
        )}
      </main>
    </>
  );
}
