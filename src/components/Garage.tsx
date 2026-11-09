import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { profileSummary } from "../../shared/carProfile";
import { fmtConsumption, fmtDate, fmtDist, fmtPerDist, fmtTotal } from "../../shared/format";
import { showCurrencyHint } from "../../shared/prefs";
import { reminderText } from "../../shared/reminders";
import {
  dismissCurrencyHint,
  dispatch,
  loadDemo,
  markReminderDone,
  openDialog,
  setActive,
  setTab,
  toast,
  useCarView,
  useStore,
  useT,
  type Tab,
} from "../lib/store";
import { ContactsTab } from "./ContactsTab";
import { DataTab } from "./DataTab";
import { FuelTab } from "./FuelTab";
import { GalleryTab } from "./GalleryTab";
import { ManualsTab } from "./ManualsTab";
import { LampIcon, PersonIcon } from "./icons";
import { LangMenu } from "./LangMenu";
import { HeadlineMoney } from "./Ledger";
import { Mono } from "./Mono";
import { Odometer } from "./Odometer";
import { RemindersTab } from "./RemindersTab";
import { ServiceTab } from "./ServiceTab";
import { StatsTab } from "./StatsTab";
import { WishesTab } from "./WishesTab";

/** Назва проєкту: «D.» підсвічено, як колись друге слово. */
export const Brand = ({ large }: { large?: boolean }) => (
  <div className={`brand${large ? " brand-large" : ""}`} aria-label="D.Garage">
    <span className="brand-accent">D.</span>Garage
  </div>
);

function TopBar() {
  const t = useT();
  const cars = useStore((s) => s.data.cars);
  const active = useStore((s) => s.active);
  const user = useStore((s) => s.user);
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <Brand />
        <nav className="car-chips" aria-label={t.topbar.cars}>
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
            {t.topbar.addCar}
          </button>
        </nav>
        <LangMenu />
        <button
          type="button"
          className="icon-btn account-btn"
          aria-label={t.topbar.profile(user?.name || user?.email || "")}
          onClick={() => openDialog({ type: "account" })}
        >
          <PersonIcon />
        </button>
      </div>
    </header>
  );
}

function Banners() {
  const t = useT();
  const demo = useStore((s) => s.data.demo);
  const offline = useStore((s) => s.offline);
  const pending = useStore((s) => s.queue.length);
  const storageOk = useStore((s) => s.storageOk);
  const currencyHint = useStore((s) => showCurrencyHint(s.prefs));
  return (
    <>
      {currencyHint && (
        <div className="banner banner-quiet">
          <p>{t.currency.suggest}</p>
          <div className="banner-actions">
            <button
              type="button"
              className="btn btn-ink btn-small"
              onClick={() => {
                dismissCurrencyHint();
                openDialog({ type: "account" });
              }}
            >
              {t.currency.choose}
            </button>
            <button type="button" className="btn btn-quiet btn-small" onClick={dismissCurrencyHint}>
              {t.currency.noThanks}
            </button>
          </div>
        </div>
      )}
      {demo && (
        <div className="banner">
          <p>
            <strong>{t.banners.demoStrong}</strong> {t.banners.demoText}
          </p>
          <div className="banner-actions">
            <button
              type="button"
              className="btn btn-ink btn-small"
              onClick={() => {
                dispatch({ type: "demo.set", value: false });
                toast(t.banners.kept);
              }}
            >
              {t.banners.keep}
            </button>
            <button
              type="button"
              className="btn btn-quiet btn-small"
              onClick={() => {
                dispatch({ type: "all.del" });
                openDialog({ type: "car" });
              }}
            >
              {t.banners.startOver}
            </button>
          </div>
        </div>
      )}
      {offline && (
        <div className="banner banner-quiet" role="status">
          <p>
            <strong>{t.banners.offlineStrong}</strong> {pending ? t.banners.offlinePending(pending) : t.banners.offlineCached}
          </p>
        </div>
      )}
      {!storageOk && (
        <div className="banner banner-bad" role="alert">
          <p>
            <strong>{t.banners.storageStrong}</strong> {t.banners.storageText}
          </p>
        </div>
      )}
    </>
  );
}

function EmptyGarage() {
  const t = useT();
  return (
    <section className="empty-garage">
      <h1 className="display">{t.empty.title}</h1>
      <p>{t.empty.text}</p>
      <div className="empty-actions">
        <button type="button" className="btn btn-ink" onClick={() => openDialog({ type: "car" })}>
          {t.empty.addCar}
        </button>
        <button type="button" className="btn btn-quiet" onClick={() => setTab("data")}>
          {t.empty.restore}
        </button>
        <button type="button" className="btn btn-quiet" onClick={loadDemo}>
          {t.empty.demo}
        </button>
      </div>
    </section>
  );
}

function ReminderStrip({ carId }: { carId: string }) {
  const t = useT();
  const { urgentReminders: rows } = useCarView(carId);
  if (!rows.length) return null;
  const shown = rows.slice(0, 3);
  return (
    <section className="lamps" aria-label={t.strip.aria}>
      {shown.map(({ reminder, status }) => (
        <div key={reminder.id} className={`lamp lamp-${status.level}`}>
          <span className="lamp-icon">
            <LampIcon />
          </span>
          <button type="button" className="lamp-text" onClick={() => openDialog({ type: "reminder", reminder })}>
            <Mono text={reminderText(status, reminder.title)} />
          </button>
          <button type="button" className="btn btn-small btn-quiet" onClick={() => markReminderDone(reminder)}>
            {t.reminders.done}
          </button>
        </div>
      ))}
      {rows.length > shown.length && (
        <button type="button" className="link-btn" onClick={() => setTab("reminders")}>
          {t.strip.all(rows.length)}
        </button>
      )}
    </section>
  );
}

function Hero({ carId, actionsRef }: { carId: string; actionsRef: RefObject<HTMLDivElement | null> }) {
  const t = useT();
  const unit = useStore((s) => s.prefs.unit);
  const name = useStore((s) => s.data.cars.find((c) => c.id === carId)?.name);
  const profile = useStore((s) => s.data.cars.find((c) => c.id === carId)?.profile);
  const profileLine = profileSummary(profile, t);
  const { summary: s, fuelTotals: f, totals, second } = useCarView(carId);

  return (
    <section className="hero">
      <div className="hero-top">
        <div className="hero-title">
          <h1 className="display">{name}</h1>
          {profileLine && (
            <p className="hero-profile">
              <Mono text={profileLine} />
            </p>
          )}
          <p className="hero-sub">
            <Mono text={s.hasRecords ? t.hero.since(fmtDate(s.since), fmtDist(s.driven)) : t.hero.noRecords} />
          </p>
        </div>
        <Odometer value={s.currentOdo} />
      </div>
      <div ref={actionsRef} className="hero-actions">
        <button type="button" className="btn btn-fuel" onClick={() => openDialog({ type: "fuel", car: carId })}>
          {t.hero.addFuel}
        </button>
        <button type="button" className="btn btn-service" onClick={() => openDialog({ type: "service", car: carId })}>
          {t.hero.addService}
        </button>
      </div>
      <dl className="gauges">
        <div className="gauge gauge-main">
          <dt>{t.hero.total}</dt>
          <dd>
            <HeadlineMoney total={totals.all} second={second} />
          </dd>
        </div>
        <div className="gauge">
          <dt>{t.hero.service}</dt>
          <dd>{fmtTotal(totals.service)}</dd>
        </div>
        <div className="gauge">
          <dt>{t.hero.fuel}</dt>
          <dd>{fmtTotal(totals.fuel)}</dd>
        </div>
        <div className="gauge">
          <dt>{t.hero.avgConsumption}</dt>
          <dd>{fmtConsumption(f.avg)}</dd>
        </div>
        <div className="gauge">
          <dt>{t.hero.perDist[unit]}</dt>
          <dd>{fmtPerDist(s.perKm)}</dd>
        </div>
      </dl>
    </section>
  );
}

function Tabs({ carId }: { carId: string }) {
  const t = useT();
  const tab = useStore((s) => s.tab);
  const { urgentReminders, staleRecords } = useCarView(carId);

  const items: { id: Tab; label: string; badge?: number }[] = [
    { id: "service", label: t.tabs.service, badge: staleRecords.size },
    { id: "fuel", label: t.tabs.fuel },
    { id: "reminders", label: t.tabs.reminders, badge: urgentReminders.length },
    { id: "wishes", label: t.tabs.wishes },
    { id: "manuals", label: t.tabs.manuals },
    { id: "contacts", label: t.tabs.contacts },
    { id: "gallery", label: t.tabs.gallery },
    { id: "stats", label: t.tabs.stats },
    { id: "data", label: t.tabs.data },
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
      <div className="tabs" role="tablist" aria-label={t.tabs.aria} onKeyDown={onKey}>
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
  const t = useT();
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
        {t.hero.addFuel}
      </button>
      <button
        type="button"
        className="btn btn-service"
        tabIndex={visible ? 0 : -1}
        onClick={() => openDialog({ type: "service", car: carId })}
      >
        {t.hero.addService}
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
              {tab === "wishes" && <WishesTab carId={carId} />}
              {tab === "manuals" && <ManualsTab carId={carId} />}
              {tab === "contacts" && <ContactsTab carId={carId} />}
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
