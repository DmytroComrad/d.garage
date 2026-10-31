import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { fmtConsumption, fmtDate, fmtKm, fmtMoney, fmtMoney0 } from "../../shared/format";
import { reminderText } from "../../shared/reminders";
import { dispatch, loadDemo, markReminderDone, openDialog, setActive, setTab, toast, useCarView, useStore, type Tab } from "../lib/store";
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
  const cars = useStore((s) => s.data.cars);
  const active = useStore((s) => s.active);
  const user = useStore((s) => s.user);
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <div className="brand" aria-label="Гараж Амедро">
          <span>Гараж</span> <span className="brand-accent">Амедро</span>
        </div>
        <nav className="car-chips" aria-label="Машины">
          {cars.map((c) => (
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
  const demo = useStore((s) => s.data.demo);
  const offline = useStore((s) => s.offline);
  const pending = useStore((s) => s.queue.length);
  const storageOk = useStore((s) => s.storageOk);
  return (
    <>
      {demo && (
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
            {pending
              ? `Несохранённых изменений: ${pending}. Отправятся сами, когда появится интернет.`
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
  const { urgentReminders: rows } = useCarView(carId);
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

function Hero({ carId, actionsRef }: { carId: string; actionsRef: RefObject<HTMLDivElement | null> }) {
  const name = useStore((s) => s.data.cars.find((c) => c.id === carId)?.name);
  const { summary: s, fuelTotals: f } = useCarView(carId);

  return (
    <section className="hero">
      <div className="hero-top">
        <div className="hero-title">
          <h1 className="display">{name}</h1>
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
  const tab = useStore((s) => s.tab);
  const { urgentReminders } = useCarView(carId);

  const items: { id: Tab; label: string; badge?: number }[] = [
    { id: "service", label: "Обслуживание" },
    { id: "fuel", label: "Заправки" },
    { id: "reminders", label: "Напоминания", badge: urgentReminders.length },
    { id: "gallery", label: "Галерея" },
    { id: "stats", label: "Статистика" },
    { id: "data", label: "Данные" },
  ];

  // На телефоні вкладки гортаються: вибрана не має лишатися за краєм.
  useEffect(() => {
    document.getElementById(`tab-${tab}`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [tab]);

  const onKey = (e: KeyboardEvent) => {
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
function QuickBar({ carId, actionsRef }: { carId: string; actionsRef: RefObject<HTMLDivElement | null> }) {
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
  const tab = useStore((s) => s.tab);
  const carId = useStore((s) => (s.active && s.data.cars.some((c) => c.id === s.active) ? s.active : null));
  const actionsRef = useRef<HTMLDivElement>(null);

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
