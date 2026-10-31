import "@fontsource-variable/unbounded/wght.css";
import "@fontsource-variable/golos-text/wght.css";
import "@fontsource-variable/jetbrains-mono/wght.css";
import "./styles.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { boot } from "./lib/store";

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
void boot();
