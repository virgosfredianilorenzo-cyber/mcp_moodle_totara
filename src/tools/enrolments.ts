import { z } from "zod";
import { MoodleClient } from "../moodleClient.js";

export const getEnrolledUsers = {
  name: "moodle_get_enrolled_users",
  description: "Liste les utilisateurs inscrits dans un cours.",
  inputSchema: z.object({
    courseid: z.number().describe("ID du cours"),
  }),
  outputSchema: z.object({
    users: z.array(
      z.object({
        id: z.number(),
        username: z.string(),
        firstname: z.string(),
        lastname: z.string(),
        email: z.string(),
      })
    ),
  }),
  handler: async (params: { courseid: number }, client: MoodleClient) => {
    const response = await client.callFunction<any[]>("core_enrol_get_enrolled_users", {
      courseid: params.courseid,
    });
    const users = response.map((user: any) => ({
      id: user.id,
      username: user.username,
      firstname: user.firstname,
      lastname: user.lastname,
      email: user.email,
    }));
    return { users };
  },
};
