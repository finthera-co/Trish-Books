import { Outlet } from "react-router-dom";
import GlobalTopNav from "./GlobalTopNav";

export default function AppLayout() {
  return (
    <div className="flex flex-col h-screen w-full overflow-hidden">
      <GlobalTopNav />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Outlet />
      </div>
    </div>
  );
}
