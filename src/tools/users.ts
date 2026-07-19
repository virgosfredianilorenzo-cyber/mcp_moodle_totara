import { z } from "zod";
import { MoodleClient } from "../moodleClient.js";
import { UserSchema } from "../types.js";

export const getUsers = {
  name: "moodle_get_users",
  description: "Récupère une liste d'utilisateurs Moodle.",
  inputSchema: z.object({
    criteria: z.array(
      z.object({
        key: z.enum(["id", "username", "email"]),
        value: z.union([z.string(), z.number()]),
      })
    ).optional(),
  }),
  outputSchema: z.object({
    users: z.array(UserSchema),
  }),
  handler: async (params: { criteria?: Array<{ key: string; value: string | number }> }, client: MoodleClient) => {
    const response = await client.callFunction<{ users: any[] }>("core_user_get_users", params);
    const users = response.users.map((user: any) => ({
      id: user.id,
      username: user.username,
      firstname: user.firstname,
      lastname: user.lastname,
      email: user.email,
    }));
    return { users };
  },
};
