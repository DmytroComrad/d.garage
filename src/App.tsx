import { AuthScreen } from "./components/Auth";
import { Dialogs } from "./components/Dialogs";
import { Garage } from "./components/Garage";
import { useApp } from "./lib/store";

export function App() {
  const { phase } = useApp();
  if (phase === "loading") {
    return <div className="splash" role="status" aria-label="Загрузка" />;
  }
  return (
    <>
      {phase === "anon" ? <AuthScreen /> : <Garage />}
      <Dialogs />
    </>
  );
}
