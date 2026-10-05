import { useSession } from "./auth";
import { useStore } from "./store";

/** Which smarter reader the app will use right now: the brain's Bedrock, the AWS endpoint, or none (on-phone rules). */
export function useSmartAi(): "brain" | "cloud" | null {
  const { state } = useStore();
  const session = useSession();
  if (state.brain?.ai) return "brain";
  if (session && state.settings.cloudAi) return "cloud";
  return null;
}

export const AI_LABEL = {
  brain: "Read by Amazon Bedrock through the brain on your computer.",
  cloud: "Read by Amazon Bedrock through your FirstDay account.",
  phone: "Read on your phone. Nothing leaves it.",
} as const;
