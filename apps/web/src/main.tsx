import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/manrope";
import "@fontsource-variable/jetbrains-mono";
import "./styles.css";
import { App } from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { createHistoryStore } from "./lib/history";

const store = createHistoryStore();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <App store={store} />
    </ErrorBoundary>
  </StrictMode>,
);
