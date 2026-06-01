import { invoke } from "@tauri-apps/api/core";
import { setApiBase } from "@/lib/api";

export type EnvConfigStatus = {
  configured: boolean;
  env_path: string;
  api_base: string;
  api_ready: boolean;
  api_error: string | null;
};

export type EnvConfigInput = {
  database_url: string;
  jwt_secret: string;
  api_addr?: string;
};

export async function getEnvConfigStatus(): Promise<EnvConfigStatus | null> {
  try {
    const status = await invoke<EnvConfigStatus>("get_env_config_status");
    setApiBase(status.api_base);
    return status;
  } catch {
    return null;
  }
}

export async function saveEnvConfig(
  input: EnvConfigInput,
): Promise<EnvConfigStatus> {
  const status = await invoke<EnvConfigStatus>("save_env_config", { input });
  setApiBase(status.api_base);
  return status;
}
