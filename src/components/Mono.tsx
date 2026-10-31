/** Цифри в тексті моноширинним шрифтом (п. 3.11), решта — основним. */
export const Mono = ({ text }: { text: string }) => (
  <>
    {text.split(/(\d(?:[\d.,: ]*\d)?)/).map((part, i) =>
      i % 2 ? (
        <span key={i} className="num">
          {part}
        </span>
      ) : (
        part
      ),
    )}
  </>
);
