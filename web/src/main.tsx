import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { SenderView } from "./SenderView";
import "./styles.css";

const isSenderRoute = window.location.pathname.startsWith("/send");

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {isSenderRoute ? <SenderView /> : <App />}
  </React.StrictMode>,
);
