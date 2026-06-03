import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { SenderView } from "./SenderView";
import { TrendingView } from "./TrendingView";
import { ImagesView } from "./ImagesView";
import "./styles.css";

const path = window.location.pathname;

const view = path.startsWith("/send")
  ? <SenderView />
  : path.startsWith("/news/trending")
  ? <TrendingView />
  : path.startsWith("/images")
  ? <ImagesView />
  : <App />;

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>{view}</React.StrictMode>,
);
