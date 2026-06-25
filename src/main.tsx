import ReactDOM from "react-dom/client";
import App from "./App";

// No StrictMode: its double-invoked effects would spawn/attach the PTY twice.
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <App />,
);
