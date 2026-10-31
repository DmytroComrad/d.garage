import { AuthScreen } from "./components/Auth";
import { Dialogs } from "./components/Dialogs";
import { Garage } from "./components/Garage";
import { useStore } from "./lib/store";

export function App() {
  const phase = useStore((s) => s.phase);
  // Посилання для скидання пароля має показати форму й тому, хто вже в акаунті.
  const resetToken = useStore((s) => s.resetToken);
  if (phase === "loading") {
    return <div className="splash" role="status" aria-label="Загрузка" />;
  }
  return (
    <>
      {phase === "anon" || resetToken ? <AuthScreen /> : <Garage />}
      <Dialogs />
    </>
  );
}
