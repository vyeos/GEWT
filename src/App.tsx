import { useEffect, useState } from "react";
import { toast } from "sonner";
import "./App.css";
import { AppShell } from "@/components/app/AppShell";
import { branchesSeed } from "@/data/seeds";
import { Admission } from "@/features/admission/Admission";
import { Login } from "@/features/login/Login";
import { Outstanding } from "@/features/outstanding/Outstanding";
import { Receipt } from "@/features/receipt/Receipt";
import { Utility } from "@/features/utility/Utility";
import { api } from "@/lib/api";
import { syncAll } from "@/lib/cache";
import type { Branch, Course, Me, Screen } from "@/types";

type Theme = "light" | "dark";

function getInitialTheme(): Theme {
  const savedTheme = localStorage.getItem("gewt-theme");
  if (savedTheme === "light" || savedTheme === "dark") {
    return savedTheme;
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function App() {
  const [token, setToken] = useState(localStorage.getItem("gewt-token"));
  const [me, setMe] = useState<Me | null>(null);
  const [screen, setScreen] = useState<Screen>("admission");
  const [branches, setBranches] = useState<Branch[]>(branchesSeed);
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(false);
  const [screenRefreshKey, setScreenRefreshKey] = useState(0);
  const [theme, setTheme] = useState<Theme>(getInitialTheme);

  async function refresh(session = token) {
    if (!session) return;
    setLoading(true);
    try {
      const [profile, branchList, courseList] = await Promise.all([
        api<Me>("/auth/me", session),
        api<Branch[]>("/branches", session),
        api<Course[]>("/courses", session),
      ]);
      setMe(profile);
      setBranches(branchList);
      setCourses(courseList);

      syncAll(session, profile).catch(() =>
        toast.warning("Sync incomplete — showing cached data"),
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to load GEWT data",
      );
    } finally {
      setLoading(false);
    }
  }

  async function refreshCurrentScreen() {
    await refresh();
    setScreenRefreshKey((key) => key + 1);
  }

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem("gewt-theme", theme);
  }, [theme]);

  function logout() {
    localStorage.removeItem("gewt-token");
    setToken(null);
    setMe(null);
  }

  if (!token || !me) {
    return (
      <Login
        onLogin={(nextToken) => {
          localStorage.setItem("gewt-token", nextToken);
          setToken(nextToken);
          void refresh(nextToken);
        }}
      />
    );
  }

  return (
    <AppShell
      me={me}
      screen={screen}
      loading={loading}
      isDarkMode={theme === "dark"}
      onScreenChange={setScreen}
      onThemeChange={(isDarkMode) => setTheme(isDarkMode ? "dark" : "light")}
      onRefresh={() => void refreshCurrentScreen()}
      onLogout={logout}
    >
      {screen === "admission" && (
        <Admission
          token={token}
          me={me}
          branches={branches}
          courses={courses}
          onSaved={() => void refreshCurrentScreen()}
        />
      )}
      {screen === "receipt" && (
        <Receipt
          token={token}
          me={me}
          branches={branches}
          courses={courses}
          refreshKey={screenRefreshKey}
        />
      )}
      {screen === "outstanding" && (
        <Outstanding
          token={token}
          refreshKey={screenRefreshKey}
          branches={branches}
        />
      )}
      {screen === "utility" && (
        <Utility
          token={token}
          me={me}
          branches={branches}
          courses={courses}
          refreshKey={screenRefreshKey}
          onSaved={() => void refreshCurrentScreen()}
        />
      )}
    </AppShell>
  );
}

export default App;
