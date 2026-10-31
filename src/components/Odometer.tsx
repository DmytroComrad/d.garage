import { useEffect, useState } from "react";
import { fmtNum } from "../../shared/format";

const DIGITS = "0123456789".split("");

/** Механічний барабан: стрічка цифр їде вгору, як на справжньому лічильнику. */
const Reel = ({ digit, dim, position }: { digit: number; dim: boolean; position: number }) => (
  <span className={`reel${dim ? " is-dim" : ""}`}>
    <span
      className="reel-strip"
      style={{
        transform: `translateY(${-digit * 10}%)`,
        // Правий барабан крутиться найдовше: швидкий розряд на лічильнику завжди рухається більше.
        transitionDuration: `${900 + position * 160}ms`,
      }}
    >
      {DIGITS.map((d) => (
        <span key={d} className="reel-digit">
          {d}
        </span>
      ))}
    </span>
  </span>
);

export function Odometer({ value, decorative }: { value: number | null; decorative?: boolean }) {
  // Перший кадр на нулях, далі показ: так барабани прокручуються при відкритті.
  const [shown, setShown] = useState<number | null>(value == null ? null : 0);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setShown(value));
    return () => cancelAnimationFrame(frame);
  }, [value]);

  const label = value == null ? "Пробег пока не указан" : `Пробег ${fmtNum(value)} км`;
  const a11y = decorative ? { "aria-hidden": true } : { role: "img", "aria-label": label };
  const className = "odometer";

  if (value == null || shown == null) {
    return (
      <div className={className} {...a11y}>
        <span className="reels">
          {Array.from({ length: 6 }, (_, i) => (
            <span key={i} className="reel is-dim">
              <span className="reel-digit">–</span>
            </span>
          ))}
        </span>
        <span className="odometer-unit">км</span>
      </div>
    );
  }

  const target = String(value).padStart(6, "0");
  const current = String(shown).padStart(target.length, "0");
  const significant = target.search(/[1-9]/);

  return (
    <div className={className} {...a11y}>
      <span className="reels">
        {target.split("").map((_, i) => (
          <Reel
            key={target.length - i}
            digit={Number(current[i])}
            dim={significant === -1 ? i < target.length - 1 : i < significant}
            position={i}
          />
        ))}
      </span>
      <span className="odometer-unit">км</span>
    </div>
  );
}
