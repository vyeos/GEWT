import { useEffect, useState } from "react";
import { toast } from "sonner";
import "./App.css";
import { AppShell } from "@/components/app/AppShell";
import { Admission } from "@/features/admission/Admission";
import { Backup } from "@/features/backup/Backup";
import { BootError } from "@/features/boot/BootError";
import { Login } from "@/features/login/Login";
import { Outstanding } from "@/features/outstanding/Outstanding";
import { Promote } from "@/features/promote/Promote";
import { Receipt } from "@/features/receipt/Receipt";
import { Students } from "@/features/students/Students";
import { Utility } from "@/features/utility/Utility";
import {
  api,
  bootStatus,
  currentUser,
  dbDataVersion,
  logout as logoutCommand,
  type BootInfo,
} from "@/lib/api";
import { canAccessScreen, firstAccessibleScreen } from "@/lib/access";
import type { Branch, Course, Me, Screen } from "@/types";

// How often, in LAN mode, to check whether another machine has written.
const LAN_POLL_MS = 2500;

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
  const [branches, setBranches] = useState<Branch[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(false);
  const [restoringSession, setRestoringSession] = useState(true);
  const [screenRefreshKey, setScreenRefreshKey] = useState(0);
  const [boot, setBoot] = useState<BootInfo | null>(null);
  const [theme, setTheme] = useState<Theme>(getInitialTheme);

  async function loadData(profile: Me) {
    setLoading(true);
    try {
      const [branchList, courseList] = await Promise.all([
        api<Branch[]>("/branches", SESSION),
        api<Course[]>("/courses", SESSION),
      ]);
      setMe(profile);
      setScreen((current) =>
        canAccessScreen(profile, current) ? current : firstAccessibleScreen(profile),
      );
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
        // Read the startup outcome first. If the database could not be opened
        // (e.g. a configured LAN folder is offline) there is no session to
        // restore — the BootError screen takes over below.
        const status = await bootStatus();
        if (cancelled) return;
        setBoot(status);
        if (status.error) return;
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

  // In LAN mode, poll SQLite's data_version so another machine's writes show up
  // here within a couple of seconds. Local mode never starts the interval.
  useEffect(() => {
    if (!boot?.lan_active || !me) return;
    let lastVersion: number | null = null;
    const timer = setInterval(() => {
      void dbDataVersion()
        .then((version) => {
          if (lastVersion !== null && version !== lastVersion) {
            void refreshCurrentScreen();
          }
          lastVersion = version;
        })
        .catch(() => {
          // Transient (e.g. a peer holds the write lock); try again next tick.
        });
    }, LAN_POLL_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boot?.lan_active, me]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem("gewt-theme", theme);
  }, [theme]);

  async function logout() {
    await logoutCommand().catch(() => {});
    setMe(null);
  }

  // The database could not be opened (e.g. an offline LAN folder). Block here
  // rather than silently using a divergent local copy.
  if (boot?.error) {
    return <BootError boot={boot} />;
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
      {screen === "admission" && canAccessScreen(me, "admission") && (
        <Admission
          token={SESSION}
          me={me}
          branches={branches}
          courses={courses}
          onSaved={() => void refreshCurrentScreen()}
        />
      )}
      {screen === "receipt" && canAccessScreen(me, "receipt") && (
        <Receipt
          token={SESSION}
          me={me}
          branches={branches}
          courses={courses}
          refreshKey={screenRefreshKey}
        />
      )}
      {screen === "promote" && canAccessScreen(me, "promote") && (
        <Promote
          token={SESSION}
          me={me}
          branches={branches}
          courses={courses}
          refreshKey={screenRefreshKey}
          onPromoted={() => void refreshCurrentScreen()}
        />
      )}
      {screen === "outstanding" && canAccessScreen(me, "outstanding") && (
        <Outstanding
          token={SESSION}
          me={me}
          refreshKey={screenRefreshKey}
          branches={branches}
          courses={courses}
        />
      )}
      {screen === "students" && canAccessScreen(me, "students") && (
        <Students
          token={SESSION}
          me={me}
          refreshKey={screenRefreshKey}
          branches={branches}
          courses={courses}
          onSaved={() => void refreshCurrentScreen()}
        />
      )}
      {screen === "backup" && canAccessScreen(me, "backup") && (
        <Backup me={me} branches={branches} />
      )}
      {screen === "utility" && canAccessScreen(me, "utility") && (
        <Utility
          token={SESSION}
          me={me}
          branches={branches}
          refreshKey={screenRefreshKey}
          onSaved={() => void refreshCurrentScreen()}
        />
      )}
    </AppShell>
  );
}

export default App;
