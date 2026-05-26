import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { SenderView } from "./SenderView";
import { NewsCardsView } from "./NewsCardsView";
import { PersonNewsView } from "./PersonNewsView";
import { TrendingView } from "./TrendingView";
import { TemplatesView } from "./TemplatesView";
import { StudioView } from "./StudioView";
import "./styles.css";

const path = window.location.pathname;

// Redirect bare /news → /news/industry so old links keep working.
if (path === "/news" || path === "/news/") {
  window.location.replace("/news/industry");
}

const view = path.startsWith("/send")
  ? <SenderView />
  : path.startsWith("/news/trending")
  ? <TrendingView />
  : path.startsWith("/news/person")
  ? <PersonNewsView />
  : path.startsWith("/news")
  ? <NewsCardsView />
  : path.startsWith("/templates")
  ? <TemplatesView />
  : path.startsWith("/studio")
  ? <StudioView />
  : <App />;

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>{view}</React.StrictMode>,
);
