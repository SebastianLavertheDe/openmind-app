import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { installBrowserPreviewApi } from "./browser-api";
import "./styles.css";
import "./styles/product.css";

installBrowserPreviewApi();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
