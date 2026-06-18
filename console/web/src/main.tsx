import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { ToastProvider } from "./components/Toast";
import { AppearanceProvider } from "./context/AppearanceContext";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <AppearanceProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </AppearanceProvider>
    </BrowserRouter>
  </StrictMode>
);
