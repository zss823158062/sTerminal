import React from "react";
import ReactDOM from "react-dom/client";
import "./styles/global.css";

// App 组件由 DEV-D 实现，此处提供占位组件
function App() {
  return (
    <div style={{ color: "white", padding: "20px" }}>
      <h1>sTerminal</h1>
      <p>正在初始化...</p>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
