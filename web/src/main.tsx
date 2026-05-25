import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { SenderView } from "./SenderView";
import { NewsCardsView } from "./NewsCardsView";
import { AllNewsView } from "./AllNewsView";
import { PersonNewsView } from "./PersonNewsView";
import { TemplatesView } from "./TemplatesView";
import "./styles.css";

const path = window.location.pathname;

// Redirect bare /news → /news/industry so old links keep working.
if (path === "/news" || path === "/news/") {
  window.location.replace("/news/industry");
}

const view = path.startsWith("/send")
  ? <SenderView />
  : path.startsWith("/news/all")
  ? <AllNewsView />
  : path.startsWith("/news/person")
  ? <PersonNewsView />
  : path.startsWith("/news")
  ? <NewsCardsView />
  : path.startsWith("/templates")
  ? <TemplatesView />
  : <App />;

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>{view}</React.StrictMode>,
);
