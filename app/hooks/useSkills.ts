import { useEffect, useState } from "react";
import { request } from "../api/client";

export type Skill = {
  name: string;
  description: string;
  longDescription?: string;
};

type SkillsResponse = { skills: Skill[] };

// Fetches the agent-advertised slash commands once on mount. Failures are
// silent — the slash menu just stays empty rather than showing a banner,
// since this is a discovery feature, not core chat functionality.
export function useSkills(apiUrl: string): {
  skills: Skill[];
  isLoading: boolean;
} {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await request<SkillsResponse>(`${apiUrl}/api/skills`, {
          nullOn404: true,
        });
        if (!cancelled && data?.skills) {
          setSkills(data.skills);
        }
      } catch {
        // Swallow — the menu degrades to empty if the backend doesn't have
        // skills wired up.
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiUrl]);

  return { skills, isLoading };
}

// invokeSkill POSTs the user's pick to the messaging server, which forwards
// it to the agent as a typed SkillInvocation over the gRPC stream.
export async function invokeSkill(
  apiUrl: string,
  conversationId: string,
  skill: string,
  args: string,
): Promise<void> {
  await request(`${apiUrl}/api/conversations/${conversationId}/invocations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ skill, args }),
  });
}
