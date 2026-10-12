import React from "react";
import ReactDOM from "react-dom/client";
import App from "./app/App";
import { installFonts } from "./render/fonts";
import "./styles/app.css";

if (import.meta.env.DEV) void import("./app/devHooks").then((m) => m.installDevHooks());

// Fonts must be ready before the first layout so text is measured correctly.
installFonts().then(() => {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
});
