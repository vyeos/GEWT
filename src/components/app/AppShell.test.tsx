import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "@/components/app/AppShell";
import { makeMe } from "@/test/factories";
import type { Me, Screen } from "@/types";

vi.mock("@/lib/updater", () => ({
  checkForUpdate: vi.fn().mockResolvedValue({ available: false, update: undefined }),
  downloadUpdate: vi.fn(),
  installAndRelaunch: vi.fn(),
}));

function renderShell(me: Me, screen: Screen = "admission") {
  const handlers = {
    onScreenChange: vi.fn(),
    onThemeChange: vi.fn(),
    onRefresh: vi.fn(),
    onLogout: vi.fn(),
  };
  return {
    ...handlers,
    ...render(
      <AppShell
        me={me}
        screen={screen}
        loading={false}
        isDarkMode={false}
        onScreenChange={handlers.onScreenChange}
        onThemeChange={handlers.onThemeChange}
        onRefresh={handlers.onRefresh}
        onLogout={handlers.onLogout}
      >
        <div>Screen body</div>
      </AppShell>,
    ),
  };
}

describe("AppShell UI", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("hides admin utility and denied feature navigation for employees", () => {
    renderShell(
      makeMe({
        role: "employee",
        branch_id: "branch-1",
        branch_name: "Prantij",
        can_receipt: false,
        can_students: false,
      }),
    );

    expect(screen.getByRole("button", { name: /Admission/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Fee Receipt/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Students/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Utility/ })).not.toBeInTheDocument();
    expect(screen.getByText("Prantij")).toBeInTheDocument();
  });

  it("shows utility for admins and triggers refresh", async () => {
    const onRefresh = vi.fn();

    render(
      <AppShell
        me={makeMe({ role: "admin" })}
        screen="utility"
        loading={false}
        isDarkMode={false}
        onScreenChange={vi.fn()}
        onThemeChange={vi.fn()}
        onRefresh={onRefresh}
        onLogout={vi.fn()}
      >
        <div>Screen body</div>
      </AppShell>,
    );

    await userEvent.click(screen.getByRole("button", { name: /Refresh/ }));
    expect(screen.getByRole("heading", { name: "Utility" })).toBeInTheDocument();
    expect(onRefresh).toHaveBeenCalled();
  });

  it("opens the sign-out confirmation before logging out", async () => {
    const onLogout = vi.fn();

    render(
      <AppShell
        me={makeMe()}
        screen="admission"
        loading={false}
        isDarkMode={false}
        onScreenChange={vi.fn()}
        onThemeChange={vi.fn()}
        onRefresh={vi.fn()}
        onLogout={onLogout}
      >
        <div>Screen body</div>
      </AppShell>,
    );

    await userEvent.click(screen.getByRole("button", { name: /Sign out/i }));
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(onLogout).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Sign Out" }));
    await waitFor(() => expect(onLogout).toHaveBeenCalled());
  });
});
