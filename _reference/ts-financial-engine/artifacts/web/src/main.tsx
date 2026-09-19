import { createRoot } from "react-dom/client";
import { setAuthTokenGetter } from "@workspace/api-client-react";
import App from "./App";
import "./index.css";

// Route-aware token getter: admin routes use adminToken, driver routes use driverToken
setAuthTokenGetter(() => {
  const path = window.location.pathname;
  if (path.startsWith("/driver")) {
    return localStorage.getItem("driverToken");
  }
  return localStorage.getItem("adminToken");
});

createRoot(document.getElementById("root")!).render(<App />);
