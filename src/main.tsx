import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import "./styles.css";

// The PWA worker auto-activates the newest bundle after a deployment. Local
// novels remain in memory/IndexedDB; the app shell can safely refresh.
registerSW({ immediate: true });

const root = document.getElementById("root");
if (!root) throw new Error("Reader root element is missing.");

createRoot(root).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>,
);
