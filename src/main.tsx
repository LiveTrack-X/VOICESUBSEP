import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";
import "./theme.css";
import "./i18n.css";
import "./workspace-layout.css";
import { I18nProvider } from "./i18n";
import { installDiagnosticHandlers } from "./diagnostics";
import { initializeTheme } from "./theme";

initializeTheme();
const removeDiagnosticHandlers = installDiagnosticHandlers();
if (import.meta.hot) import.meta.hot.dispose(removeDiagnosticHandlers);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <I18nProvider><App /></I18nProvider>
  </React.StrictMode>,
);
