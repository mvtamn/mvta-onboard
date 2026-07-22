import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App.js";
import "./styles.css";

// Bootstrap branches on auth mode:
//  - mock (dev preview only): no MSAL at all — MockAuthProvider supplies a fake
//    account + role switcher. Guarded by import.meta.env.DEV, which is
//    statically `false` in production builds, so Vite tree-shakes the whole
//    mock path (including the dynamic import) out of the bundle.
//  - msal (default / production): initialize MSAL before rendering.
async function bootstrap() {
  const root = ReactDOM.createRoot(document.getElementById("root")!);

  if (import.meta.env.DEV && import.meta.env.VITE_AUTH_MODE === "mock") {
    const { MockAuthProvider } = await import("./auth/MockAuthProvider.js");
    root.render(
      <React.StrictMode>
        <MockAuthProvider>
          <BrowserRouter basename="/console">
            <App />
          </BrowserRouter>
        </MockAuthProvider>
      </React.StrictMode>,
    );
    return;
  }

  const [{ MsalProvider }, { EventType }, { getMsalInstance }, { MsalAuthProvider }] =
    await Promise.all([
      import("@azure/msal-react"),
      import("@azure/msal-browser"),
      import("./auth/msalConfig.js"),
      import("./auth/AuthContext.js"),
    ]);

  const msalInstance = getMsalInstance();
  await msalInstance.initialize();

  const accounts = msalInstance.getAllAccounts();
  if (accounts.length > 0) {
    msalInstance.setActiveAccount(accounts[0]);
  }

  msalInstance.addEventCallback((event) => {
    if (event.eventType === EventType.LOGIN_SUCCESS && event.payload && "account" in event.payload) {
      msalInstance.setActiveAccount((event.payload as { account: never }).account);
    }
  });

  root.render(
    <React.StrictMode>
      <MsalProvider instance={msalInstance}>
        <MsalAuthProvider>
          <BrowserRouter basename="/console">
            <App />
          </BrowserRouter>
        </MsalAuthProvider>
      </MsalProvider>
    </React.StrictMode>,
  );
}

void bootstrap();
