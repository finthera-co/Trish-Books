import { Outlet } from "react-router-dom";
import GlobalTopNav from "./GlobalTopNav";

export default function AppLayout() {
  return (
    <div className="flex flex-col min-h-screen w-full">
      <GlobalTopNav />
      <div className="flex-1 flex flex-col min-w-0">
        <Outlet />
      </div>
    </div>
  );
}
