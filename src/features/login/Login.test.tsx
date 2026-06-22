import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Login } from "@/features/login/Login";
import { login } from "@/lib/api";
import { makeMe } from "@/test/factories";

vi.mock("@/lib/api", () => ({
  login: vi.fn(),
}));

const loginMock = vi.mocked(login);

describe("Login UI", () => {
  beforeEach(() => {
    loginMock.mockResolvedValue(makeMe());
  });

  it("submits credentials and reports the signed-in user", async () => {
    const user = userEvent.setup();
    const onLogin = vi.fn();

    render(<Login onLogin={onLogin} />);

    await user.type(screen.getByLabelText("User ID"), "IRRN");
    await user.type(screen.getByLabelText("Password"), "Ripal@1305");
    await user.click(screen.getByRole("button", { name: "Sign In" }));

    expect(loginMock).toHaveBeenCalledWith("IRRN", "Ripal@1305");
    await waitFor(() => expect(onLogin).toHaveBeenCalledWith(makeMe()));
  });

  it("disables the submit button while the request is in flight", async () => {
    const user = userEvent.setup();
    let resolveLogin: (value: ReturnType<typeof makeMe>) => void = () => {};
    loginMock.mockReturnValue(
      new Promise((resolve) => {
        resolveLogin = resolve;
      }),
    );

    render(<Login onLogin={vi.fn()} />);

    await user.type(screen.getByLabelText("User ID"), "IRRN");
    await user.type(screen.getByLabelText("Password"), "Ripal@1305");
    await user.click(screen.getByRole("button", { name: "Sign In" }));

    expect(screen.getByRole("button", { name: "Signing in..." })).toBeDisabled();

    resolveLogin(makeMe());
    await waitFor(() => expect(screen.getByRole("button", { name: "Sign In" })).toBeEnabled());
  });

  it("keeps the user on the login screen after a failed sign-in", async () => {
    const user = userEvent.setup();
    const onLogin = vi.fn();
    loginMock.mockRejectedValueOnce(new Error("Invalid password"));

    render(<Login onLogin={onLogin} />);

    await user.type(screen.getByLabelText("User ID"), "IRRN");
    await user.type(screen.getByLabelText("Password"), "wrong");
    await user.click(screen.getByRole("button", { name: "Sign In" }));

    await waitFor(() => expect(loginMock).toHaveBeenCalledWith("IRRN", "wrong"));
    expect(onLogin).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Sign In" })).toBeEnabled();
  });
});
