import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/manrope";
import "@fontsource-variable/jetbrains-mono";
import "./styles.css";
import { App } from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { createHistoryStore } from "./lib/history";

/** Creates the history store inside the error boundary, so a failure there is caught too. */
function Root() {
  const [store] = useState(createHistoryStore);
  return <App store={store} />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <Root />
    </ErrorBoundary>
  </StrictMode>,
);
