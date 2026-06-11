import { useEffect, useState } from "react";
import { toast } from "sonner";
import "./App.css";
import { AppShell } from "@/components/app/AppShell";
import { branchesSeed } from "@/data/seeds";
import { Admission } from "@/features/admission/Admission";
import { Backup } from "@/features/backup/Backup";
import { Login } from "@/features/login/Login";
import { Outstanding } from "@/features/outstanding/Outstanding";
import { Promote } from "@/features/promote/Promote";
import { Receipt } from "@/features/receipt/Receipt";
import { Students } from "@/features/students/Students";
import { Utility } from "@/features/utility/Utility";
import { api, currentUser, logout as logoutCommand } from "@/lib/api";
import type { Branch, Course, Me, Screen } from "@/types";

type Theme = "light" | "dark";

// The session lives in the Rust backend; the frontend only needs a non-empty
// placeholder to satisfy the feature components' `token` prop (it is ignored by
// the local command dispatcher).
const SESSION = "local";

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
  const [me, setMe] = useState<Me | null>(null);
  const [screen, setScreen] = useState<Screen>("admission");
  const [branches, setBranches] = useState<Branch[]>(branchesSeed);
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(false);
  const [restoringSession, setRestoringSession] = useState(true);
  const [screenRefreshKey, setScreenRefreshKey] = useState(0);
  const [theme, setTheme] = useState<Theme>(getInitialTheme);

  async function loadData(profile: Me) {
    setLoading(true);
    try {
      const [branchList, courseList] = await Promise.all([
        api<Branch[]>("/branches", SESSION),
        api<Course[]>("/courses", SESSION),
      ]);
      setMe(profile);
      setBranches(branchList);
      setCourses(courseList);
      return true;
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to load GEWT data",
      );
      return false;
    } finally {
      setLoading(false);
    }
  }

  async function refresh() {
    try {
      const profile = await currentUser();
      if (!profile) {
        setMe(null);
        return;
      }
      await loadData(profile);
    } catch {
      // Ignore — the user can retry.
    }
  }

  async function refreshCurrentScreen() {
    await refresh();
    setScreenRefreshKey((key) => key + 1);
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const profile = await currentUser();
        if (cancelled) return;
        if (profile) await loadData(profile);
      } finally {
        if (!cancelled) setRestoringSession(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem("gewt-theme", theme);
  }, [theme]);

  async function logout() {
    await logoutCommand().catch(() => {});
    setMe(null);
  }

  if (restoringSession && !me) {
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
            <p className="text-sm text-muted-foreground">Loading...</p>
          </div>
        </div>
      </div>
    );
  }

  if (!me) {
    return <Login onLogin={(profile) => void loadData(profile)} />;
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
      onLogout={() => void logout()}
    >
      {screen === "admission" && (
        <Admission
          token={SESSION}
          me={me}
          branches={branches}
          courses={courses}
          onSaved={() => void refreshCurrentScreen()}
        />
      )}
      {screen === "receipt" && (
        <Receipt
          token={SESSION}
          me={me}
          branches={branches}
          courses={courses}
          refreshKey={screenRefreshKey}
        />
      )}
      {screen === "promote" && (
        <Promote
          token={SESSION}
          me={me}
          branches={branches}
          courses={courses}
          refreshKey={screenRefreshKey}
          onPromoted={() => void refreshCurrentScreen()}
        />
      )}
      {screen === "outstanding" && (
        <Outstanding
          token={SESSION}
          me={me}
          refreshKey={screenRefreshKey}
          branches={branches}
          courses={courses}
        />
      )}
      {screen === "students" && (
        <Students
          token={SESSION}
          me={me}
          refreshKey={screenRefreshKey}
          branches={branches}
          courses={courses}
          onSaved={() => void refreshCurrentScreen()}
        />
      )}
      {screen === "backup" && <Backup me={me} branches={branches} />}
      {screen === "utility" && (
        <Utility
          token={SESSION}
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
