import { useEffect, useState } from "react";
import { toast } from "sonner";
import "./App.css";
import { AppShell } from "@/components/app/AppShell";
import { branchesSeed } from "@/data/seeds";
import { Admission } from "@/features/admission/Admission";
import { Login } from "@/features/login/Login";
import { Outstanding } from "@/features/outstanding/Outstanding";
import { Promote } from "@/features/promote/Promote";
import { Receipt } from "@/features/receipt/Receipt";
import { Students } from "@/features/students/Students";
import { Utility } from "@/features/utility/Utility";
import { api, ApiRequestError } from "@/lib/api";
import { syncAll } from "@/lib/cache";
import { getEnvConfigStatus } from "@/lib/env-config";
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

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function App() {
  const [token, setToken] = useState(localStorage.getItem("gewt-token"));
  const [me, setMe] = useState<Me | null>(null);
  const [screen, setScreen] = useState<Screen>("admission");
  const [branches, setBranches] = useState<Branch[]>(branchesSeed);
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(false);
  const [restoringSession, setRestoringSession] = useState(
    () => Boolean(localStorage.getItem("gewt-token")),
  );
  const [screenRefreshKey, setScreenRefreshKey] = useState(0);
  const [theme, setTheme] = useState<Theme>(getInitialTheme);

  async function refresh(session = token, showError = true) {
    if (!session) return false;
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
      return true;
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 401) {
        localStorage.removeItem("gewt-token");
        setToken(null);
        setMe(null);
      }
      if (showError) {
        toast.error(
          error instanceof Error ? error.message : "Unable to load GEWT data",
        );
      }
      return false;
    } finally {
      setLoading(false);
    }
  }

  async function refreshCurrentScreen() {
    await refresh();
    setScreenRefreshKey((key) => key + 1);
  }

  useEffect(() => {
    let cancelled = false;

    async function restoreSavedSession() {
      if (!token) {
        setRestoringSession(false);
        return;
      }

      const configStatus = await getEnvConfigStatus();
      if (cancelled) return;
      if (configStatus?.configured === false) {
        setRestoringSession(false);
        return;
      }
      if (configStatus?.configured && !configStatus.api_ready) {
        for (let attempt = 0; attempt < 20; attempt += 1) {
          await wait(250);
          if (cancelled) return;

          const nextStatus = await getEnvConfigStatus();
          if (cancelled) return;
          if (nextStatus?.api_ready || nextStatus?.api_error) {
            break;
          }
        }
      }

      await refresh(token, false);
      if (!cancelled) {
        setRestoringSession(false);
      }
    }

    void restoreSavedSession();

    return () => {
      cancelled = true;
    };
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

  if (restoringSession && token && !me) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <div className="flex flex-col items-center gap-3 text-center">
          <img
            src="/logo.png"
            alt="GEWT logo"
            className="size-16 object-contain"
          />
          <div>
            <p className="text-sm font-medium text-foreground">
              Opening GEWT Fees
            </p>
            <p className="text-sm text-muted-foreground">
              Restoring your session...
            </p>
          </div>
        </div>
      </div>
    );
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
      {screen === "promote" && (
        <Promote
          token={token}
          me={me}
          branches={branches}
          courses={courses}
          refreshKey={screenRefreshKey}
          onPromoted={() => void refreshCurrentScreen()}
        />
      )}
      {screen === "outstanding" && (
        <Outstanding
          token={token}
          me={me}
          refreshKey={screenRefreshKey}
          branches={branches}
          courses={courses}
        />
      )}
      {screen === "students" && (
        <Students
          token={token}
          me={me}
          refreshKey={screenRefreshKey}
          branches={branches}
          courses={courses}
          onSaved={() => void refreshCurrentScreen()}
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
